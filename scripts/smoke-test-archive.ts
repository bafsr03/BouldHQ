// Smoke-test the archive/delete flow end-to-end against the live DB.
// Creates an isolated test store, archives → unarchives → archives → deletes,
// asserting on visibility through the same Prisma queries the routes use.

import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const TEST_NAME = `__archive_smoke_${Date.now()}`;

async function main() {
  const team = await p.team.findFirst({ where: { slug: 'bouldhq' } });
  const account = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!team || !account) throw new Error('Missing fixtures');

  // Fixture: tag + storeProfile + a fake request to test cascade.
  const tag = await p.tag.create({
    data: { name: TEST_NAME, parent: 0, accountId: account.id, teamId: team.id },
  });
  await p.storeProfile.create({
    data: { tagId: tag.id, accountId: account.id, storeUrl: 'archive-test.example' },
  });
  const note = await p.notes.create({
    data: { accountId: account.id, content: 'note that should survive delete' },
  });
  await p.tagsToNote.create({ data: { noteId: note.id, tagId: tag.id } });
  const req = await p.storeRequest.create({
    data: {
      teamId: team.id, tagId: tag.id, createdById: account.id,
      source: 'text', rawBody: 'archive smoke req', attachmentIds: [],
      status: 'pending_triage',
    },
  });

  const countActiveProfiles = () =>
    p.storeProfile.count({ where: { tag: { teamId: team.id, archivedAt: null } } });
  const countAllProfiles = () =>
    p.storeProfile.count({ where: { tag: { teamId: team.id } } });
  const countActiveTags = () =>
    p.tag.count({ where: { teamId: team.id, parent: 0, archivedAt: null, name: TEST_NAME } });
  const countOpenRequestsForTag = () =>
    p.storeRequest.count({
      where: {
        teamId: team.id, tagId: tag.id,
        status: { notIn: ['done', 'auto_done'] },
        tag: { archivedAt: null },
      },
    });

  const before = {
    activeProfiles: await countActiveProfiles(),
    allProfiles: await countAllProfiles(),
    activeTag: await countActiveTags(),
    openCounted: await countOpenRequestsForTag(),
  };

  // Archive.
  await p.tag.update({
    where: { id: tag.id },
    data: { archivedAt: new Date(), archivedById: account.id },
  });
  const afterArchive = {
    activeProfiles: await countActiveProfiles(),
    allProfiles: await countAllProfiles(),
    activeTag: await countActiveTags(),
    openCounted: await countOpenRequestsForTag(),
  };

  // Unarchive.
  await p.tag.update({
    where: { id: tag.id },
    data: { archivedAt: null, archivedById: null },
  });
  const afterUnarchive = {
    activeProfiles: await countActiveProfiles(),
    activeTag: await countActiveTags(),
    openCounted: await countOpenRequestsForTag(),
  };

  // Archive then delete.
  await p.tag.update({
    where: { id: tag.id },
    data: { archivedAt: new Date(), archivedById: account.id },
  });
  await p.$transaction([
    p.tagsToNote.deleteMany({ where: { tagId: tag.id } }),
    p.tag.delete({ where: { id: tag.id } }),
  ]);

  const noteSurvived = !!(await p.notes.findUnique({ where: { id: note.id } }));
  const profileGone = !(await p.storeProfile.findFirst({ where: { tagId: tag.id } }));
  const requestGone = !(await p.storeRequest.findUnique({ where: { id: req.id } }));

  console.log(JSON.stringify({
    before,
    afterArchive,
    afterUnarchive,
    afterDelete: { noteSurvived, profileGone, requestGone },
  }, null, 2));

  const ok =
    before.activeProfiles === before.allProfiles &&
    before.activeTag === 1 &&
    before.openCounted === 1 &&
    afterArchive.activeProfiles === before.activeProfiles - 1 &&
    afterArchive.allProfiles === before.allProfiles &&
    afterArchive.activeTag === 0 &&
    afterArchive.openCounted === 0 &&
    afterUnarchive.activeProfiles === before.activeProfiles &&
    afterUnarchive.activeTag === 1 &&
    afterUnarchive.openCounted === 1 &&
    noteSurvived && profileGone && requestGone;

  // Cleanup the orphaned note.
  await p.notes.delete({ where: { id: note.id } });

  console.log(ok ? '\n✓ archive/delete smoke OK' : '\n✗ archive/delete smoke FAILED');
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
