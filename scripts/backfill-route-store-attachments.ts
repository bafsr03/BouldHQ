// Backfill: scan every attachment that's linked to a note tagged with one (or
// more) team-store tags, and route it under the right Branding Assets/<store>/.
//
// What this fixes: images saved into a store note before the auto-route logic
// existed (or where the note's tag layout meant the routing was skipped). Idempotent —
// attachments already filed under the correct folder are left alone.
//
// Strategy:
//   For each accountId owning at least one team membership:
//     - Pull every attachment that has a noteId AND isn't already under
//       "Branding Assets,<something>".
//     - For each, look at the note's tags.tag.teamId — pick the team-store
//       tag (parent=0, teamId in my teams). If multiple, pick the one with
//       the longest name (most specific store name like "JCK.Approved" beats "JCK").
//     - Route to "Branding Assets,<storeName>".

// pathConstant captures process.cwd() at import time — server runs from server/,
// so we must chdir before importing FileService/bouldhq.
import path from 'path';
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { routeAttachmentToBrandingFolder } = await import('../server/lib/bouldhq');

  const p = new PrismaClient();
  try {
    // Every accountId that's a member of any team.
    const memberships = await p.teamMember.findMany({
      select: { accountId: true, teamId: true },
    });
    const teamIdsByAccount = new Map<number, Set<number>>();
    for (const m of memberships) {
      if (!teamIdsByAccount.has(m.accountId)) teamIdsByAccount.set(m.accountId, new Set());
      teamIdsByAccount.get(m.accountId)!.add(m.teamId);
    }

    let inspected = 0;
    let alreadyOk = 0;
    let routed = 0;
    let skippedNoStoreTag = 0;
    const sampleRouted: Array<{ id: number; name: string; from: string; to: string }> = [];

    for (const [accountId, teamIds] of teamIdsByAccount.entries()) {
      // Candidate attachments — owned by this account, attached to a note,
      // not already routed under a Branding Assets/<store>/ folder.
      const candidates = await p.attachments.findMany({
        where: {
          accountId,
          noteId: { not: null },
          NOT: { perfixPath: { startsWith: 'Branding Assets,' } },
        },
        include: {
          note: {
            include: {
              tags: {
                include: { tag: { select: { id: true, name: true, parent: true, teamId: true } } },
              },
            },
          },
        },
      });

      for (const att of candidates) {
        inspected++;
        if (!att.note) continue;

        // Climb to top-level for every tag on this note. A note tagged with a
        // sub-tag (e.g. "Branding Assets/Joon" sub-tag) still implies the
        // root store — walk up.
        const rootNames = new Set<string>();
        for (const t of att.note.tags) {
          const tag = t.tag;
          if (!tag) continue;
          // Fast path: this tag is itself a top-level team-store tag.
          if (tag.parent === 0 && tag.teamId != null && teamIds.has(tag.teamId)) {
            rootNames.add(tag.name);
            continue;
          }
          // Slow path: walk up to the root.
          let cur: { id: number; parent: number; name: string; teamId: number | null } | null = tag;
          // Bound the loop in case of cycles.
          for (let i = 0; i < 8 && cur && cur.parent !== 0; i++) {
            cur = await p.tag.findUnique({
              where: { id: cur.parent },
              select: { id: true, name: true, parent: true, teamId: true },
            });
          }
          if (cur && cur.parent === 0 && cur.teamId != null && teamIds.has(cur.teamId)) {
            rootNames.add(cur.name);
          }
        }

        if (rootNames.size === 0) { skippedNoStoreTag++; continue; }
        // Pick the most specific (longest) store name on ties.
        const chosen = [...rootNames].sort((a, b) => b.length - a.length)[0];

        const target = `Branding Assets,${chosen}`;
        if (att.perfixPath === target) { alreadyOk++; continue; }

        await routeAttachmentToBrandingFolder(att.id, accountId, chosen);
        routed++;
        if (sampleRouted.length < 10) {
          sampleRouted.push({
            id: att.id, name: att.name,
            from: att.perfixPath ?? '',
            to: target,
          });
        }
      }
    }

    console.log(JSON.stringify({
      inspectedCandidates: inspected,
      alreadyCorrectlyFiled: alreadyOk,
      routedThisRun: routed,
      skippedNoteHadNoStoreTag: skippedNoStoreTag,
      sampleRouted,
    }, null, 2));
    console.log('\n✓ backfill complete');
  } finally {
    await p.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); process.exit(1); });
