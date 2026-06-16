import { prisma } from "../prisma";
import { BaseScheduleJob } from "./baseScheduleJob";
import { ensureWeeklyTrackerNoteForTeam } from "../lib/bouldhq";

export class WeeklyTrackerJob extends BaseScheduleJob {
  protected static taskName = 'bouldhq-weekly-tracker';
  // Mondays at 00:05 UTC. Slight offset from midnight so the new ISO week is fully resolved.
  protected static cronSchedule = '5 0 * * 1';

  protected static async RunTask() {
    const teams = await prisma.team.findMany({ select: { id: true } });
    for (const t of teams) {
      try {
        await ensureWeeklyTrackerNoteForTeam(t.id);
      } catch (err) {
        console.error(`[bouldhq-weekly-tracker] team ${t.id} failed`, err);
      }
    }
    return { processed: teams.length };
  }
}
