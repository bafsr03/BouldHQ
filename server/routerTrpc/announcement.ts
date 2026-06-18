import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@server/prisma';
import {
  router,
  authProcedure,
  founderProcedure,
} from '@server/middleware';

const CATEGORIES = ['announcement', 'changelog', 'workflow_update'] as const;
type Category = typeof CATEGORIES[number];

const announcementSchema = z.object({
  id: z.number(),
  teamId: z.number().nullable(),
  authorId: z.number(),
  category: z.enum(CATEGORIES),
  title: z.string(),
  body: z.string(),
  pinned: z.boolean(),
  ownersOnly: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  author: z.object({
    id: z.number(),
    name: z.string(),
    nickname: z.string(),
    image: z.string(),
  }).nullable(),
});

export const announcementRouter = router({
  // List announcements visible to the caller: every global (teamId=null) +
  // every announcement scoped to a team they belong to. Pinned first, then recent.
  list: authProcedure
    .input(z.object({
      category: z.enum(CATEGORIES).optional(),
      limit: z.number().min(1).max(100).default(30),
    }))
    .output(z.array(announcementSchema))
    .query(async ({ input, ctx }) => {
      const memberships = await prisma.teamMember.findMany({
        where: { accountId: Number(ctx.id) },
        select: { teamId: true },
      });
      const teamIds = memberships.map((m) => m.teamId);

      const rows = await prisma.announcement.findMany({
        where: {
          ownersOnly: false,   // owner-only posts are hidden from the staff /hq feed
          ...(input.category && { category: input.category }),
          OR: [
            { teamId: null },
            ...(teamIds.length ? [{ teamId: { in: teamIds } }] : []),
          ],
        },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: input.limit,
        include: {
          author: { select: { id: true, name: true, nickname: true, image: true } },
        },
      });
      return rows.map((r) => ({ ...r, category: r.category as Category }));
    }),

  // Only founders can post announcements, workflow updates, or changelog
  // entries — for any scope (global or a specific team). Managers and salesmen
  // are read-only on this surface.
  create: founderProcedure
    .input(z.object({
      teamId: z.number().nullable(),       // null = global broadcast
      category: z.enum(CATEGORIES).default('announcement'),
      title: z.string().min(1).max(255),
      body: z.string().min(1),
      pinned: z.boolean().default(false),
      ownersOnly: z.boolean().default(false),  // true = only brand owners see this
    }))
    .output(announcementSchema)
    .mutation(async ({ input, ctx }) => {
      // founderProcedure already enforces the caller is a founder of their
      // active team. If they specify a different team, double-check they're
      // also a founder there (paranoia for multi-team founders).
      if (input.teamId !== null && input.teamId !== ctx.teamId) {
        const membership = await prisma.teamMember.findUnique({
          where: { teamId_accountId: { teamId: input.teamId, accountId: Number(ctx.id) } },
        });
        if (!membership || membership.role !== 'founder') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a founder of that team' });
        }
      }

      const row = await prisma.announcement.create({
        data: {
          teamId: input.teamId,
          authorId: Number(ctx.id),
          category: input.category,
          title: input.title,
          body: input.body,
          pinned: input.pinned,
          ownersOnly: input.ownersOnly,
        },
        include: {
          author: { select: { id: true, name: true, nickname: true, image: true } },
        },
      });
      return { ...row, category: row.category as Category };
    }),

  togglePin: founderProcedure
    .input(z.object({ id: z.number(), pinned: z.boolean() }))
    .output(announcementSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.announcement.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (existing.teamId !== null && existing.teamId !== ctx.teamId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your team\'s announcement' });
      }
      const row = await prisma.announcement.update({
        where: { id: input.id },
        data: { pinned: input.pinned },
        include: {
          author: { select: { id: true, name: true, nickname: true, image: true } },
        },
      });
      return { ...row, category: row.category as Category };
    }),

  delete: founderProcedure
    .input(z.object({ id: z.number() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const existing = await prisma.announcement.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      // founderProcedure already gates this — any founder can delete any
      // announcement (team-scoped or global). Managers/salesmen are blocked.
      await prisma.announcement.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
