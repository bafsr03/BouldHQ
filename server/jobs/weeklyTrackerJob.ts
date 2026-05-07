import { prisma } from "../prisma";
import { BaseScheduleJob } from "./baseScheduleJob";
import { ensureWeeklyTrackerNote } from "../lib/bouldhq";

export class WeeklyTrackerJob extends BaseScheduleJob {
  protected static taskName = 'bouldhq-weekly-tracker';
  // Mondays at 00:05 UTC. Slight offset from midnight so the new ISO week is fully resolved.
  protected static cronSchedule = '5 0 * * 1';

  protected static async RunTask() {
    const accounts = await prisma.accounts.findMany({ select: { id: true } });
    for (const a of accounts) {
      try {
        await ensureWeeklyTrackerNote(a.id);
      } catch (err) {
        console.error(`[bouldhq-weekly-tracker] account ${a.id} failed`, err);
      }
    }
    return { processed: accounts.length };
  }
}
