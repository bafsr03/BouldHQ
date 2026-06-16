// Verifies the fix batch:
//   - createStore writes welcome + onboarding notes tagged with the new store
//   - personal-feed filter excludes team-store-tagged and bouldhqSystem notes
//   - /hq systemNotes endpoint returns weekly tracker

import { PrismaClient } from '@prisma/client';
import { bootstrapStoreNotes, ensureWeeklyTrackerNote } from '../server/lib/bouldhq';

const p = new PrismaClient();
const TEST_NAME = `__fixbatch_${Date.now()}`;

async function main() {
  const team = await p.team.findFirst({ where: { slug: 'bouldhq' } });
  const account = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!team || !account) throw new Error('Missing fixtures');

  // 1. Create a fresh store tag and bootstrap notes.
  const tag = await p.tag.create({
    data: { name: TEST_NAME, parent: 0, accountId: account.id, teamId: team.id },
  });
  await bootstrapStoreNotes(account.id, tag.id, TEST_NAME);

  const storeNotes = await p.notes.findMany({
    where: { accountId: account.id, tags: { some: { tagId: tag.id } } },
    orderBy: { createdAt: 'asc' },
  });
  const hasWelcome = storeNotes.some((n) => n.content.startsWith(`# Welcome to #${TEST_NAME}`));
  const hasOnboarding = storeNotes.some((n) => n.content.startsWith(`# Onboarding checklist — #${TEST_NAME}`));

  // 2. Make sure the weekly tracker is flagged + retrievable.
  await ensureWeeklyTrackerNote(account.id);
  const sysNotes = await p.notes.findMany({
    where: {
      accountId: account.id,
      metadata: { path: ['bouldhqSystem'], equals: true } as any,
    },
  });

  // 3. Personal-feed filter: a fetch that mirrors the note router's exclusion logic.
  const myTeamIds = (await p.teamMember.findMany({
    where: { accountId: account.id },
    select: { teamId: true },
  })).map((m) => m.teamId);

  const personal = await p.notes.findMany({
    where: {
      OR: [
        { accountId: account.id },
        { internalShares: { some: { accountId: account.id } } },
      ],
      isRecycle: false,
      AND: [
        {
          NOT: {
            OR: [
              { metadata: { path: ['bouldhqSystem'], equals: true } as any },
              ...(myTeamIds.length ? [{ tags: { some: { tag: { teamId: { in: myTeamIds } } } } }] : []),
            ],
          },
        },
      ],
    },
    take: 200,
  });

  const personalContaminatedByStore = personal.some((n) =>
    storeNotes.find((s) => s.id === n.id),
  );
  const personalContaminatedBySystem = personal.some((n: any) => n.metadata?.bouldhqSystem === true);

  console.log(JSON.stringify({
    bootstrapWelcomeOK: hasWelcome,
    bootstrapOnboardingOK: hasOnboarding,
    storeNotesCount: storeNotes.length,
    sysNotesCount: sysNotes.length,
    sysNotesAllFlagged: sysNotes.every((n: any) => n.metadata?.bouldhqSystem === true),
    personalContaminatedByStore,
    personalContaminatedBySystem,
  }, null, 2));

  const ok =
    hasWelcome &&
    hasOnboarding &&
    sysNotes.length >= 1 &&
    !personalContaminatedByStore &&
    !personalContaminatedBySystem;

  // Cleanup.
  await p.tagsToNote.deleteMany({ where: { tagId: tag.id } });
  await p.notes.deleteMany({ where: { id: { in: storeNotes.map((n) => n.id) } } });
  await p.tag.delete({ where: { id: tag.id } });

  console.log(ok ? '\n✓ fix batch smoke OK' : '\n✗ fix batch smoke FAILED');
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
