import { router, authProcedure } from '@server/middleware';
import { z } from 'zod';
import { prisma } from '@server/prisma';
import {
  seedDefaultResourceFolders,
  ensureBrandingFolderForTag,
  ensureWeeklyTrackerNote,
  countMonthlyCheckup,
  countNewStoresThisMonth,
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

  monthlyCheckup: authProcedure
    .input(z.void())
    .output(z.object({ reviewed: z.number(), total: z.number() }))
    .query(async ({ ctx }) => countMonthlyCheckup(Number(ctx.id))),

  newStoresThisMonth: authProcedure
    .input(z.void())
    .output(z.object({ count: z.number() }))
    .query(async ({ ctx }) => ({ count: await countNewStoresThisMonth(Number(ctx.id)) })),

  refreshWeeklyTracker: authProcedure
    .input(z.void())
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      await ensureWeeklyTrackerNote(Number(ctx.id));
      return { ok: true };
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
