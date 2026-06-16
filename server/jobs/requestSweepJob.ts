// BouldHQ — periodic sweep that keeps store-request automation moving.
//
// Two things slip through the immediate fire-and-forget path in storeRequest.ts:
//   1. Requests created while the server was restarting (autoTriage never ran).
//   2. Requests that entered auto_running but whose playbook crashed before
//      writing runLog (server died, claude binary missing, etc).
//
// This job scans for both every 5 minutes and re-kicks them.

import { prisma } from '../prisma';
import { BaseScheduleJob } from './baseScheduleJob';
import { triageStoreRequest, statusFromTriage } from '../lib/triage';
import { runPlaybook } from '../lib/playbookRunner';

const STUCK_AUTO_RUNNING_MS = 10 * 60 * 1000;   // 10 minutes — re-fire candidate
const HARD_FAIL_AUTO_RUNNING_MS = 20 * 60 * 1000; // 20 minutes — force-fail
const BATCH_LIMIT = 20;

export class RequestSweepJob extends BaseScheduleJob {
  protected static taskName = 'bouldhq-request-sweep';
  protected static cronSchedule = '*/5 * * * *';   // every 5 minutes

  protected static async RunTask() {
    let triaged = 0;
    let rerun = 0;

    // 1. Anything still in pending_triage — triage + (maybe) playbook.
    const pending = await prisma.storeRequest.findMany({
      where: { status: 'pending_triage' },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    });
    for (const req of pending) {
      try {
        const triage = await triageStoreRequest(req.rawBody);
        const nextStatus = statusFromTriage(triage);
        await prisma.storeRequest.update({
          where: { id: req.id },
          data: { triageResult: triage as any, status: nextStatus },
        });
        triaged++;
        if (nextStatus === 'auto_running') {
          runPlaybook(req.id).catch((err) =>
            console.error(`[request-sweep] runPlaybook(${req.id}) failed`, err),
          );
        }
      } catch (err) {
        console.error(`[request-sweep] triage failed for request ${req.id}`, err);
      }
    }

    // 2. auto_running requests older than STUCK_AUTO_RUNNING_MS with no runLog —
    //    the playbook crashed or the server died mid-run. Re-fire it.
    const stuckBefore = new Date(Date.now() - STUCK_AUTO_RUNNING_MS);
    const stuck = await prisma.storeRequest.findMany({
      where: {
        status: 'auto_running',
        updatedAt: { lt: stuckBefore },
        runLog: { equals: null as any },
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH_LIMIT,
    });
    for (const req of stuck) {
      runPlaybook(req.id).catch((err) =>
        console.error(`[request-sweep] runPlaybook(${req.id}) failed`, err),
      );
      rerun++;
    }

    // 3. Force-fail anything stuck in auto_running far past the playbook
    //    timeout, regardless of runLog state. Belt-and-suspenders safety so the
    //    request panel never shows a permanent "auto running" row.
    const hardFailBefore = new Date(Date.now() - HARD_FAIL_AUTO_RUNNING_MS);
    const stale = await prisma.storeRequest.findMany({
      where: { status: 'auto_running', updatedAt: { lt: hardFailBefore } },
      select: { id: true, runLog: true },
      take: BATCH_LIMIT,
    });
    let forceFailed = 0;
    for (const req of stale) {
      try {
        const existingLog = (req.runLog as any) || {};
        await prisma.storeRequest.update({
          where: { id: req.id },
          data: {
            status: 'needs_assistance',
            runLog: {
              ...existingLog,
              finishedAt: new Date().toISOString(),
              status: 'blocked',
              summary: `Force-failed by sweep after ${Math.round(HARD_FAIL_AUTO_RUNNING_MS / 60000)} min in auto_running.`,
              error: 'stuck_force_fail',
            } as any,
          },
        });
        forceFailed++;
      } catch (err) {
        console.error(`[request-sweep] force-fail update for ${req.id} failed`, err);
      }
    }

    if (triaged || rerun || forceFailed) {
      console.log(`[request-sweep] triaged=${triaged} rerun=${rerun} forceFailed=${forceFailed}`);
    }
    return { triaged, rerun, forceFailed };
  }
}
