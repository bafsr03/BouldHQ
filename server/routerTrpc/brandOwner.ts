// tRPC router for the brand-owner facing UI. Every procedure here is scoped to
// the owner's single tagId — they can never see another store, can't see team
// notes that aren't tagged with their store, can't access ops controls.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@server/prisma';
import { router, brandOwnerProcedure } from '@server/middleware';

const REQUEST_STATUSES = [
  'pending_triage', 'auto_running', 'auto_done',
  'needs_assistance', 'in_progress', 'done',
] as const;
const SOURCES = ['text', 'email', 'screenshot', 'voice'] as const;

export const brandOwnerRouter = router({
  // Profile + the single store the owner is tied to.
  me: brandOwnerProcedure
    .input(z.void())
    .output(z.object({
      ownerId: z.number(),
      accountId: z.number(),
      name: z.string(),
      email: z.string(),
      tagId: z.number(),
      storeName: z.string(),
      storeUrl: z.string().nullable(),
    }))
    .query(async ({ ctx }) => {
      const tag = await prisma.tag.findUnique({
        where: { id: ctx.tagId },
        select: { id: true, name: true, storeProfile: { select: { storeUrl: true } } },
      });
      const account = await prisma.accounts.findUnique({
        where: { id: Number(ctx.id) },
        select: { id: true, name: true, nickname: true },
      });
      if (!tag || !account) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        ownerId: ctx.ownerId,
        accountId: account.id,
        name: account.nickname || account.name,
        email: account.name,
        tagId: tag.id,
        storeName: tag.name,
        storeUrl: tag.storeProfile?.storeUrl ?? null,
      };
    }),

  // Submit a new request for the owner's store. The same triage/playbook flow
  // staff submissions go through. Owner doesn't pick a tagId — we use theirs.
  submitRequest: brandOwnerProcedure
    .input(z.object({
      rawBody: z.string().min(1),
      attachmentPaths: z.array(z.string()).default([]),
    }))
    .output(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tag = await prisma.tag.findUnique({
        where: { id: ctx.tagId },
        select: { teamId: true },
      });
      if (!tag?.teamId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not on a team' });

      // Resolve attachment paths → attachment ids (owner's own uploads only).
      let resolvedIds: number[] = [];
      let attachments: Array<{ id: number; type: string | null }> = [];
      if (input.attachmentPaths.length > 0) {
        const rows = await prisma.attachments.findMany({
          where: { path: { in: input.attachmentPaths }, accountId: Number(ctx.id) },
          select: { id: true, type: true },
        });
        resolvedIds = rows.map((r) => r.id);
        attachments = rows;
      }

      const source = attachments.some((a) => a.type?.startsWith('audio/')) ? 'voice'
        : attachments.some((a) => a.type?.startsWith('image/')) ? 'screenshot'
        : 'text';

      const created = await prisma.storeRequest.create({
        data: {
          teamId: tag.teamId,
          tagId: ctx.tagId,
          createdById: Number(ctx.id),    // owner's accounts row
          source,
          rawBody: input.rawBody,
          attachmentIds: resolvedIds,
          status: 'pending_triage',
        },
      });
      return { id: created.id };
    }),

  // List the owner's own requests + their status, runLog summary, brief.
  listMyRequests: brandOwnerProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .output(z.array(z.object({
      id: z.number(),
      status: z.enum(REQUEST_STATUSES),
      source: z.enum(SOURCES),
      rawBody: z.string(),
      runLogSummary: z.string().nullable(),
      runLogStatus: z.string().nullable(),
      hasBrief: z.boolean(),
      createdAt: z.date(),
      updatedAt: z.date(),
      closedAt: z.date().nullable(),
    })))
    .query(async ({ ctx, input }) => {
      const rows = await prisma.storeRequest.findMany({
        where: { tagId: ctx.tagId },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: input.limit,
        select: {
          id: true, status: true, source: true, rawBody: true, runLog: true,
          createdAt: true, updatedAt: true, closedAt: true,
        },
      });
      return rows.map((r) => {
        const log = r.runLog as any;
        return {
          id: r.id,
          status: r.status as any,
          source: r.source as any,
          rawBody: r.rawBody,
          runLogSummary: log?.summary ?? null,
          runLogStatus: log?.status ?? null,
          hasBrief: !!log?.brief,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          closedAt: r.closedAt,
        };
      });
    }),

  // Read-only notes the team has accumulated about THIS brand.
  // Lets the owner review brand voice, confirm or correct what the team knows.
  listMyBrandNotes: brandOwnerProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .output(z.array(z.object({
      id: z.number(),
      content: z.string(),
      author: z.string().nullable(),
      updatedAt: z.date(),
    })))
    .query(async ({ ctx, input }) => {
      const notes = await prisma.notes.findMany({
        where: {
          isRecycle: false,
          tags: { some: { tagId: ctx.tagId } },
        },
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
        include: { account: { select: { name: true, nickname: true } } },
      });
      return notes.map((n) => ({
        id: n.id,
        content: n.content,
        author: n.account?.nickname || n.account?.name || null,
        updatedAt: n.updatedAt,
      }));
    }),
});
