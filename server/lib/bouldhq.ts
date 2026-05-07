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

export async function countNewStoresThisWeek(accountId: number): Promise<number> {
  const since = startOfWeek();
  const tags = await prisma.tag.count({
    where: {
      accountId,
      parent: 0,
      createdAt: { gte: since },
      storeProfile: { isNot: null },
    },
  });
  return tags;
}

export async function countNewStoresThisMonth(accountId: number): Promise<number> {
  const since = startOfMonth();
  return prisma.tag.count({
    where: {
      accountId,
      parent: 0,
      createdAt: { gte: since },
      storeProfile: { isNot: null },
    },
  });
}

export async function countMonthlyCheckup(accountId: number): Promise<{ reviewed: number; total: number }> {
  const total = await prisma.storeProfile.count({ where: { accountId } });
  const since = startOfMonth();
  // "reviewed" = tags with at least one note created or updated this month under that store tag
  const reviewedTagIds = await prisma.tagsToNote.findMany({
    where: {
      tag: { accountId, storeProfile: { isNot: null } },
      note: { updatedAt: { gte: since } },
    },
    select: { tagId: true },
    distinct: ['tagId'],
  });
  return { reviewed: reviewedTagIds.length, total };
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

export async function ensureWeeklyTrackerNote(accountId: number): Promise<void> {
  const count = await countNewStoresThisWeek(accountId);
  const body = weeklyTrackerBody(count);

  // Identify the pinned tracker note by its title prefix + isTop flag.
  const trackerPrefix = '📊 Weekly Store Count';
  const existing = await prisma.notes.findFirst({
    where: {
      accountId,
      isTop: true,
      isRecycle: false,
      content: { startsWith: trackerPrefix },
    },
  });

  if (existing) {
    await prisma.notes.update({ where: { id: existing.id }, data: { content: body } });
    return;
  }

  await prisma.notes.create({
    data: {
      accountId,
      content: body,
      isTop: true,
      type: 0,
    },
  });
}
