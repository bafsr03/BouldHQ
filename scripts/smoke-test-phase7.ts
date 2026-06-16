// Phase 7 smoke test — exercises the playbook runner end-to-end against real DNS.
// Creates an isolated test fixture (tag + storeProfile + storeRequest), runs the
// playbook, asserts on the outcome, then deletes everything.

import { PrismaClient } from '@prisma/client';
import { runPlaybook } from '../server/lib/playbookRunner';

const p = new PrismaClient();
const TEST_NAME = `__phase7_smoke_${Date.now()}`;
const TEST_URL  = 'shopify.com';

async function main() {
  const team = await p.team.findFirst({ where: { slug: 'bouldhq' } });
  if (!team) throw new Error('Default team not found — run Phase 0 migration first');
  const founder = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!founder) throw new Error('No accounts present');

  // 1. Fixture: tag + storeProfile + storeRequest in auto_running state.
  const tag = await p.tag.create({
    data: { name: TEST_NAME, parent: 0, accountId: founder.id, teamId: team.id },
  });
  await p.storeProfile.create({
    data: { tagId: tag.id, accountId: founder.id, storeUrl: TEST_URL },
  });
  const req = await p.storeRequest.create({
    data: {
      teamId: team.id,
      tagId: tag.id,
      createdById: founder.id,
      source: 'text',
      rawBody: 'Verify DNS for the store',
      attachmentIds: [],
      status: 'auto_running',
      triageResult: {
        canAutomate: true,
        category: 'dns_record_check',
        reasoning: 'smoke test',
        suggestedAction: 'check dns',
      },
    },
  });

  // 2. Run the playbook.
  await runPlaybook(req.id);

  // 3. Read back and assert.
  const after = await p.storeRequest.findUnique({ where: { id: req.id } });
  const log: any = after?.runLog;
  console.log(JSON.stringify({
    status: after?.status,
    closedAt: !!after?.closedAt,
    runLogSummary: log?.summary,
    runLogStepCount: log?.steps?.length,
    runLogCategory: log?.category,
    firstStep: log?.steps?.[0]?.message,
    lastStep: log?.steps?.at(-1)?.message,
  }, null, 2));

  const ok = after?.status === 'auto_done'
    && Array.isArray(log?.steps)
    && log.steps.length >= 2
    && log.category === 'dns_record_check';

  // 4. Cleanup.
  await p.storeRequest.delete({ where: { id: req.id } });
  await p.storeProfile.delete({ where: { tagId: tag.id } });
  await p.tag.delete({ where: { id: tag.id } });

  console.log(ok ? '\n✓ Phase 7 smoke OK' : '\n✗ Phase 7 smoke FAILED');
  await p.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
