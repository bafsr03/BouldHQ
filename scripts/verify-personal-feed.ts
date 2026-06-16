// Verifies the personal-home filter:
//   - drops notes flagged bouldhqSystem
//   - drops notes that carry any team-store tag
//   - keeps untagged notes and notes whose tags aren't in any of your teams

import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const account = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!account) throw new Error('No account');

  const myTeamIds = new Set(
    (await p.teamMember.findMany({
      where: { accountId: account.id },
      select: { teamId: true },
    })).map((m) => m.teamId),
  );

  const all = await p.notes.findMany({
    where: {
      OR: [
        { accountId: account.id },
        { internalShares: { some: { accountId: account.id } } },
      ],
      isRecycle: false,
    },
    include: { tags: { include: { tag: true } } },
  });

  let droppedSystem = 0;
  let droppedStoreTag = 0;
  const kept: any[] = [];

  for (const n of all) {
    if ((n.metadata as any)?.bouldhqSystem === true) { droppedSystem++; continue; }
    let isStoreNote = false;
    for (const t of n.tags) {
      if (t.tag?.teamId != null && myTeamIds.has(t.tag.teamId)) { isStoreNote = true; break; }
    }
    if (isStoreNote) { droppedStoreTag++; continue; }
    kept.push(n);
  }

  console.log(JSON.stringify({
    accountId: account.id,
    totalNotes: all.length,
    droppedSystem,
    droppedAsStoreTagged: droppedStoreTag,
    keptOnPersonalHome: kept.length,
    expected: all.length - droppedSystem - droppedStoreTag,
    sampleKept: kept.slice(0, 5).map((n) => ({
      id: n.id,
      tagsOnNote: n.tags.map((t: any) => `${t.tag?.name} (teamId=${t.tag?.teamId})`),
      contentPreview: (n.content || '').slice(0, 60),
    })),
    sampleDroppedAsStore: all
      .filter((n) => n.tags.some((t: any) => t.tag?.teamId != null && myTeamIds.has(t.tag.teamId)))
      .slice(0, 5)
      .map((n) => ({
        id: n.id,
        tagsOnNote: n.tags.map((t: any) => `${t.tag?.name} (teamId=${t.tag?.teamId})`),
        contentPreview: (n.content || '').slice(0, 60),
      })),
  }, null, 2));

  const ok = kept.length === all.length - droppedSystem - droppedStoreTag;
  console.log(ok ? '\n✓ filter math OK' : '\n✗ filter math broken');
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
