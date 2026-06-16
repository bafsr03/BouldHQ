import { prisma } from '@server/prisma';

export const DEFAULT_RESOURCE_FOLDERS = [
  'SOPs',
  'Onboarding Templates',
  'AI Prompt Library',
  'Branding Assets',
  'Sales Documents',
  'Shopify AI Toolkit Prompts',
  'BouldHQ Setup Guides',
] as const;

async function ensureFolder(accountId: number, folderPath: string): Promise<void> {
  const existing = await prisma.attachments.findFirst({
    where: { accountId, type: 'folder', perfixPath: folderPath, name: '.folder' },
    select: { id: true },
  });
  if (existing) return;

  const segments = folderPath.split(',');
  const folderName = segments[segments.length - 1];
  const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : '';

  await prisma.attachments.create({
    data: {
      path: `/api/file/${parentPath ? `${parentPath}/` : ''}${folderName}/.folder`,
      name: '.folder',
      size: 0,
      type: 'folder',
      perfixPath: folderPath,
      accountId,
      isShare: false,
      sharePassword: '',
      sortOrder: 0,
    },
  });
}

export async function seedDefaultResourceFolders(accountId: number): Promise<void> {
  for (const name of DEFAULT_RESOURCE_FOLDERS) {
    await ensureFolder(accountId, name);
  }
}

// Backfill: ensure every existing top-level tag has a Branding Assets subfolder.
export async function backfillBrandingFoldersForAllTags(accountId: number): Promise<void> {
  const tags = await prisma.tag.findMany({
    where: { accountId, parent: 0 },
    select: { name: true },
  });
  for (const t of tags) {
    if (t.name) await ensureBrandingFolderForTag(accountId, t.name);
  }
}

export async function ensureBrandingFolderForTag(accountId: number, tagName: string): Promise<void> {
  if (!tagName) return;
  // Top-level "Branding Assets" must exist before any subfolder.
  await ensureFolder(accountId, 'Branding Assets');
  await ensureFolder(accountId, `Branding Assets,${tagName}`);
}

// BouldHQ Phase 8 — auto-file an uploaded attachment under a store's Branding
// Assets folder when the filename mentions one of the team's stores.
//
// Matching rule: tokenize the store name and the filename on non-alphanum
// boundaries (so "JCK.Approved" → ["jck", "approved"], and "jck-brand-guide.pdf"
// → ["jck", "brand", "guide"]). Score each store by the total length of tokens
// that match (longer tokens are more distinctive — "adophies" beats "approved").
// Highest score wins, ties broken by longer store name.
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length >= 3);
}

export async function autoRouteUploadByFilename(
  accountId: number,
  attachmentPath: string,
  fileName: string,
): Promise<{ matched: string | null }> {
  if (!fileName) return { matched: null };

  const teamIds = (await prisma.teamMember.findMany({
    where: { accountId },
    select: { teamId: true },
  })).map((m) => m.teamId);
  if (teamIds.length === 0) return { matched: null };

  const stores = await prisma.tag.findMany({
    where: { teamId: { in: teamIds }, parent: 0, archivedAt: null },
    select: { name: true },
  });
  if (stores.length === 0) return { matched: null };

  const fileTokens = new Set(tokenize(fileName));
  if (fileTokens.size === 0) return { matched: null };

  let best: { name: string; score: number } | null = null;
  for (const s of stores) {
    if (!s.name) continue;
    const storeTokens = tokenize(s.name);
    let score = 0;
    for (const t of storeTokens) if (fileTokens.has(t)) score += t.length;
    if (score <= 0) continue;
    if (!best || score > best.score
        || (score === best.score && s.name.length > best.name.length)) {
      best = { name: s.name, score };
    }
  }
  if (!best) return { matched: null };

  const attachment = await prisma.attachments.findFirst({
    where: { path: attachmentPath, accountId },
    select: { id: true },
  });
  if (!attachment) return { matched: null };

  await routeAttachmentToBrandingFolder(attachment.id, accountId, best.name);
  return { matched: best.name };
}

// Route an attachment into the per-store Branding Assets subfolder. Idempotent.
// Updates only `perfixPath` (the file's physical path stays the same — Resources groups by perfixPath).
export async function routeAttachmentToBrandingFolder(
  attachmentId: number,
  accountId: number,
  tagName: string,
): Promise<void> {
  if (!tagName) return;
  await ensureBrandingFolderForTag(accountId, tagName);
  const target = `Branding Assets,${tagName}`;
  await prisma.attachments.update({
    where: { id: attachmentId },
    data: { perfixPath: target, depth: 2 },
  });
}


export function startOfWeek(d: Date = new Date()): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function startOfMonth(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Every top-level tag IS a store — we count tag creation directly, no storeProfile row required.
export async function countNewStoresThisWeek(accountId: number): Promise<number> {
  const since = startOfWeek();
  return prisma.tag.count({
    where: { accountId, parent: 0, createdAt: { gte: since } },
  });
}

export async function countNewStoresThisMonth(accountId: number): Promise<number> {
  const since = startOfMonth();
  return prisma.tag.count({
    where: { accountId, parent: 0, createdAt: { gte: since } },
  });
}

// Team-scoped counterparts — count every store added by ANY member this week,
// not just the caller's stores. Used by the team weekly tracker so the whole
// team sees one combined number instead of N personal numbers.
export async function countNewStoresThisWeekForTeam(teamId: number): Promise<number> {
  const since = startOfWeek();
  return prisma.tag.count({
    where: { teamId, parent: 0, createdAt: { gte: since } },
  });
}

export async function countNewStoresThisMonthForTeam(teamId: number): Promise<number> {
  const since = startOfMonth();
  return prisma.tag.count({
    where: { teamId, parent: 0, createdAt: { gte: since } },
  });
}

export async function countMonthlyCheckup(accountId: number): Promise<{ reviewed: number; total: number }> {
  const total = await prisma.tag.count({ where: { accountId, parent: 0 } });
  const since = startOfMonth();
  // "reviewed" = top-level tags with at least one note touched this month
  const reviewedTagIds = await prisma.tagsToNote.findMany({
    where: {
      tag: { accountId, parent: 0 },
      note: { updatedAt: { gte: since } },
    },
    select: { tagId: true },
    distinct: ['tagId'],
  });
  return { reviewed: reviewedTagIds.length, total };
}

// Team-scoped checkup: total = every top-level store tag attached to the team,
// reviewed = tags with at least one note touched this month by any team member.
export async function countMonthlyCheckupForTeam(teamId: number): Promise<{ reviewed: number; total: number }> {
  const total = await prisma.tag.count({ where: { teamId, parent: 0 } });
  const since = startOfMonth();
  const reviewedTagIds = await prisma.tagsToNote.findMany({
    where: {
      tag: { teamId, parent: 0 },
      note: { updatedAt: { gte: since } },
    },
    select: { tagId: true },
    distinct: ['tagId'],
  });
  return { reviewed: reviewedTagIds.length, total };
}

// Return every account id that belongs to the given team. Used as the
// "visibility set" for team-shared content (attachments, store-tagged notes).
export async function teamMemberAccountIds(teamId: number): Promise<number[]> {
  const rows = await prisma.teamMember.findMany({
    where: { teamId },
    select: { accountId: true },
  });
  return rows.map((r) => r.accountId);
}

// BouldHQ Phase 8 — auto-bootstrap content for newly created stores. Both
// notes are tagged with the store tag so they appear team-wide on /stores/:tagId.
// `welcome` is short and friendly; `onboarding` is the canonical checklist.

const WELCOME_BODY = (storeName: string) =>
  `# Welcome to #${storeName}

This is the team's shared workspace for **${storeName}**. Anyone on the team can see and edit notes filed here.

- **Requests** from the store owner go in the Requests panel above.
- **Files** (logos, brand guides, screenshots) live in <code>Resources → Branding Assets → ${storeName}</code>.
- **Notes** are for everything else — meeting notes, decisions, follow-ups.

#${storeName}
`;

const ONBOARDING_CHECKLIST_BODY = (storeName: string) =>
  `# Onboarding checklist — #${storeName}

- [ ] Store access confirmed (collaborator code or direct invite accepted)
- [ ] Brand assets received (logo, colors, fonts)
- [ ] Shopify theme reviewed
- [ ] Installed apps audited
- [ ] Owner's goals documented
- [ ] First sprint planned
- [ ] DNS records check passed (see Requests panel)

#${storeName}
`;

// Creates the two default notes for a fresh store. Idempotent: re-running won't
// duplicate (matches by content prefix + accountId + tag).
export async function bootstrapStoreNotes(
  accountId: number,
  tagId: number,
  storeName: string,
): Promise<void> {
  const seed = async (content: string, isTop: boolean) => {
    const existing = await prisma.notes.findFirst({
      where: {
        accountId,
        tags: { some: { tagId } },
        content: { startsWith: content.split('\n')[0] },
      },
      select: { id: true },
    });
    if (existing) return;
    const note = await prisma.notes.create({
      data: {
        accountId,
        content,
        isTop,
        type: 0, // blinko
        // BouldHQ: stamp the store id in metadata so the personal-feed filter
        // can still recognise this as a store note even if the tag relation is
        // dropped (e.g. legacy store deletion that left orphans).
        metadata: { bouldhqStoreId: tagId } as any,
      },
    });
    await prisma.tagsToNote.create({ data: { noteId: note.id, tagId } });
  };

  await seed(WELCOME_BODY(storeName), true);
  await seed(ONBOARDING_CHECKLIST_BODY(storeName), false);
}

export function weeklyTrackerTitle(d: Date = new Date()): string {
  // Format: "📊 Weekly Store Count — Week of YYYY-MM-DD"
  const monday = startOfWeek(d);
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `📊 Weekly Store Count — Week of ${yyyy}-${mm}-${dd}`;
}

export function weeklyTrackerBody(count: number): string {
  if (count <= 0) {
    return `${weeklyTrackerTitle()}\n\n🥯\n`;
  }
  return `${weeklyTrackerTitle()}\n\n**New stores onboarded this week:** ${count}\n`;
}

// Legacy: per-account tracker. Now a thin wrapper that resolves the caller's
// active team and delegates to the team-scoped version. Kept so existing
// callers (tests, scripts) don't break.
export async function ensureWeeklyTrackerNote(accountId: number): Promise<void> {
  const membership = await prisma.teamMember.findFirst({ where: { accountId } });
  if (!membership) return;
  await ensureWeeklyTrackerNoteForTeam(membership.teamId);
}

// Team-scoped weekly tracker. Writes ONE note per team, owned by a stable
// "owner" account (the team's lowest-id founder), tagged with `teamId` in
// metadata so every team member sees the same number. Also recycles any
// legacy per-account tracker notes belonging to current team members so the
// dashboard doesn't show duplicates.
export async function ensureWeeklyTrackerNoteForTeam(teamId: number): Promise<void> {
  // Pick a stable owner account so updates always find the same row. Lowest-id
  // founder wins; if no founder, fall back to the lowest-id member.
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    orderBy: [{ role: 'asc' }, { accountId: 'asc' }],
    select: { accountId: true, role: true },
  });
  if (members.length === 0) return;
  const founder = members.find((m) => m.role === 'founder');
  const ownerAccountId = (founder ?? members[0]).accountId;

  const count = await countNewStoresThisWeekForTeam(teamId);
  const body = weeklyTrackerBody(count);

  // Find this team's tracker by metadata, not content prefix — content prefix
  // also matches legacy per-account notes which we want to recycle below.
  const existing = await prisma.notes.findFirst({
    where: {
      isRecycle: false,
      metadata: { path: ['bouldhqSystem'], equals: true } as any,
      AND: [
        { metadata: { path: ['kind'], equals: 'weekly_tracker' } as any },
        { metadata: { path: ['teamId'], equals: teamId } as any },
      ],
    },
  });

  let canonicalId: number;
  if (existing) {
    const row = await prisma.notes.update({
      where: { id: existing.id },
      data: {
        accountId: ownerAccountId,                  // keep ownership stable
        content: body,
        isTop: true,
        metadata: {
          ...(existing.metadata as any || {}),
          bouldhqSystem: true,
          kind: 'weekly_tracker',
          teamId,
        },
      },
    });
    canonicalId = row.id;
  } else {
    const row = await prisma.notes.create({
      data: {
        accountId: ownerAccountId,
        content: body,
        isTop: true,
        type: 0,
        metadata: { bouldhqSystem: true, kind: 'weekly_tracker', teamId } as any,
      },
    });
    canonicalId = row.id;
  }

  // Recycle every OTHER active weekly_tracker note belonging to a member of
  // this team. Catches both legacy per-account trackers (missing teamId) and
  // accidental duplicates. Soft-delete so we can recover if needed.
  const memberAccountIds = members.map((m) => m.accountId);
  await prisma.notes.updateMany({
    where: {
      accountId: { in: memberAccountIds },
      isRecycle: false,
      metadata: { path: ['kind'], equals: 'weekly_tracker' } as any,
      id: { not: canonicalId },
    },
    data: { isRecycle: true, isTop: false },
  });
}
