import { router, authProcedure, teamMemberProcedure } from '@server/middleware';
import { z } from 'zod';
import { prisma } from '@server/prisma';
import {
  seedDefaultResourceFolders,
  ensureBrandingFolderForTag,
  ensureWeeklyTrackerNote,
  ensureWeeklyTrackerNoteForTeam,
  countMonthlyCheckup,
  countMonthlyCheckupForTeam,
  countNewStoresThisMonth,
  countNewStoresThisMonthForTeam,
  backfillBrandingFoldersForAllTags,
  routeAttachmentToBrandingFolder,
} from '@server/lib/bouldhq';

export const bouldhqRouter = router({
  bootstrap: authProcedure
    .input(z.void())
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      const accountId = Number(ctx.id);
      await seedDefaultResourceFolders(accountId);
      await backfillBrandingFoldersForAllTags(accountId);
      await ensureWeeklyTrackerNote(accountId);
      return { ok: true };
    }),

  ensureBrandingFolder: authProcedure
    .input(z.object({ tagName: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ensureBrandingFolderForTag(Number(ctx.id), input.tagName);
      return { ok: true };
    }),

  // Team-scoped: every team member sees the same numbers. Falls back to the
  // caller's own counts only if they aren't on a team.
  monthlyCheckup: teamMemberProcedure
    .input(z.void())
    .output(z.object({ reviewed: z.number(), total: z.number() }))
    .query(async ({ ctx }) => countMonthlyCheckupForTeam(ctx.teamId)),

  newStoresThisMonth: teamMemberProcedure
    .input(z.void())
    .output(z.object({ count: z.number() }))
    .query(async ({ ctx }) => ({ count: await countNewStoresThisMonthForTeam(ctx.teamId) })),

  refreshWeeklyTracker: teamMemberProcedure
    .input(z.void())
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      await ensureWeeklyTrackerNoteForTeam(ctx.teamId);
      return { ok: true };
    }),

  // BouldHQ Phase 8 — surface system-generated notes (weekly tracker, etc.) on
  // /hq. Team-scoped: every member sees the same notes for their active team.
  systemNotes: teamMemberProcedure
    .input(z.void())
    .output(z.array(z.object({
      id: z.number(),
      content: z.string(),
      kind: z.string().nullable(),
      isTop: z.boolean(),
      createdAt: z.date(),
      updatedAt: z.date(),
    })))
    .query(async ({ ctx }) => {
      // Refresh on read so the number isn't stale between weekly cron runs.
      await ensureWeeklyTrackerNoteForTeam(ctx.teamId);
      const rows = await prisma.notes.findMany({
        where: {
          isRecycle: false,
          metadata: { path: ['bouldhqSystem'], equals: true } as any,
          AND: [
            { metadata: { path: ['teamId'], equals: ctx.teamId } as any },
          ],
        },
        orderBy: [{ isTop: 'desc' }, { updatedAt: 'desc' }],
        take: 20,
      });
      return rows.map((n) => ({
        id: n.id,
        content: n.content,
        kind: (n.metadata as any)?.kind ?? null,
        isTop: n.isTop,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
    }),

  // Route an uploaded attachment (looked up by its file path) into Branding Assets/<tagName>/.
  routeAttachmentByPath: authProcedure
    .input(z.object({ path: z.string().min(1), tagName: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const accountId = Number(ctx.id);
      const att = await prisma.attachments.findFirst({ where: { path: input.path, accountId } });
      if (!att) return { ok: false };
      await routeAttachmentToBrandingFolder(att.id, accountId, input.tagName);
      return { ok: true };
    }),
});
