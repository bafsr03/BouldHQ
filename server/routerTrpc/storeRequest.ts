import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@server/prisma';
import {
  router,
  teamMemberProcedure,
  managerProcedure,
} from '@server/middleware';
import { triageStoreRequest, statusFromTriage } from '@server/lib/triage';
import { runPlaybook } from '@server/lib/playbookRunner';
import { openRequestInAntigravity } from '@server/lib/opsConsole';

// Fire-and-forget triage. Runs the LLM classifier, writes triageResult, and
// transitions status. If the LLM isn't configured the request stays in
// pending_triage → needs_assistance so a human picks it up. When triage routes
// to auto_running, the playbook runner is invoked immediately (also fire-and-forget).
async function autoTriage(requestId: number) {
  try {
    const req = await prisma.storeRequest.findUnique({ where: { id: requestId } });
    if (!req || req.status !== 'pending_triage') return;
    const triage = await triageStoreRequest(req.rawBody);
    const nextStatus = statusFromTriage(triage);
    await prisma.storeRequest.update({
      where: { id: requestId },
      data: {
        triageResult: triage as any,
        status: nextStatus,
      },
    });
    if (nextStatus === 'auto_running') {
      runPlaybook(requestId).catch((err) => console.error('runPlaybook failed', err));
    }
  } catch (err) {
    console.error('autoTriage failed', err);
    // Leave the request in pending_triage so it can be manually re-triaged.
  }
}

const STATUSES = [
  'pending_triage',
  'auto_running',
  'auto_done',
  'needs_assistance',
  'in_progress',
  'done',
] as const;

const SOURCES = ['text', 'email', 'screenshot', 'voice'] as const;
type SourceLiteral = typeof SOURCES[number];

// Infer the request source from what the user actually attached + the body
// shape. Replaces the old user-facing "Source" radio (which was confusing —
// every choice opened the same textarea). The user never has to think about
// this anymore; the UI offers real input affordances (file, voice memo) and
// we tag the record server-side.
function inferSourceFromAttachments(
  rawBody: string,
  attachments: Array<{ type: string | null }>,
): SourceLiteral {
  if (attachments.some((a) => a.type?.startsWith('audio/'))) return 'voice';
  if (attachments.some((a) => a.type?.startsWith('image/'))) return 'screenshot';
  // Crude but stable email-shaped-content detection.
  if (/^(from|subject|to|cc|reply-to):/im.test(rawBody)) return 'email';
  return 'text';
}

const requestSchema = z.object({
  id: z.number(),
  teamId: z.number(),
  tagId: z.number(),
  createdById: z.number(),
  assigneeId: z.number().nullable(),
  source: z.enum(SOURCES),
  rawBody: z.string(),
  attachmentIds: z.array(z.number()),
  triageResult: z.any().nullable(),
  status: z.enum(STATUSES),
  jobId: z.string().nullable(),
  runLog: z.any().nullable(),
  managerNotes: z.string().nullable(),
  closedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

async function assertTagInTeam(tagId: number, teamId: number) {
  const tag = await prisma.tag.findFirst({ where: { id: tagId, teamId } });
  if (!tag) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Store tag not found in your team' });
  }
}

export const storeRequestRouter = router({
  list: teamMemberProcedure
    .input(z.object({
      tagId: z.number().optional(),
      status: z.enum(STATUSES).optional(),
      assigneeId: z.number().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .output(z.array(requestSchema))
    .query(async ({ ctx, input }) => {
      return prisma.storeRequest.findMany({
        where: {
          teamId: ctx.teamId,
          ...(input.tagId && { tagId: input.tagId }),
          ...(input.status && { status: input.status }),
          ...(input.assigneeId && { assigneeId: input.assigneeId }),
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: input.limit,
      });
    }),

  get: teamMemberProcedure
    .input(z.object({ id: z.number() }))
    .output(requestSchema)
    .query(async ({ ctx, input }) => {
      const req = await prisma.storeRequest.findFirst({
        where: { id: input.id, teamId: ctx.teamId },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      return req;
    }),

  // Any team member (salesman / manager / founder) can submit a request.
  // Status starts as 'pending_triage'; AI triage fires asynchronously.
  //
  // Source: optional input. If the client passes one we trust it; otherwise
  // we infer from the attachment mime types + body shape (audio → 'voice',
  // image → 'screenshot', email-y headers → 'email', else 'text').
  // attachmentPaths: convenience input for clients that just uploaded a file
  // via /api/file/upload and only have a /api/file/... path — we resolve to
  // the matching attachment row(s) here.
  create: teamMemberProcedure
    .input(z.object({
      tagId: z.number(),
      source: z.enum(SOURCES).optional(),
      rawBody: z.string().min(1),
      attachmentIds: z.array(z.number()).default([]),
      attachmentPaths: z.array(z.string()).default([]),
    }))
    .output(requestSchema)
    .mutation(async ({ ctx, input }) => {
      await assertTagInTeam(input.tagId, ctx.teamId);

      // Resolve attachment paths → ids so we end up with a single list.
      let resolvedIds = [...input.attachmentIds];
      let resolvedAttachments: Array<{ id: number; type: string | null }> = [];
      if (input.attachmentPaths.length > 0) {
        const rows = await prisma.attachments.findMany({
          where: { path: { in: input.attachmentPaths }, accountId: Number(ctx.id) },
          select: { id: true, type: true },
        });
        resolvedAttachments.push(...rows);
        resolvedIds.push(...rows.map((r) => r.id));
      }
      if (input.attachmentIds.length > 0) {
        const rows = await prisma.attachments.findMany({
          where: { id: { in: input.attachmentIds } },
          select: { id: true, type: true },
        });
        resolvedAttachments.push(...rows);
      }
      // Dedupe — a client could pass both ids and paths pointing at the same file.
      resolvedIds = Array.from(new Set(resolvedIds));

      const source: SourceLiteral = input.source
        ?? inferSourceFromAttachments(input.rawBody, resolvedAttachments);

      const created = await prisma.storeRequest.create({
        data: {
          teamId: ctx.teamId,
          tagId: input.tagId,
          createdById: Number(ctx.id),
          source,
          rawBody: input.rawBody,
          attachmentIds: resolvedIds,
          status: 'pending_triage',
        },
      });
      autoTriage(created.id);
      return created;
    }),

  // Manager+ : run / re-run AI triage on an existing request. Useful when the
  // LLM was unconfigured at create time, or the salesman edited the rawBody.
  // If triage routes to auto_running, the playbook runner is invoked.
  runTriage: managerProcedure
    .input(z.object({ id: z.number() }))
    .output(requestSchema)
    .mutation(async ({ ctx, input }) => {
      const req = await prisma.storeRequest.findFirst({
        where: { id: input.id, teamId: ctx.teamId },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      const triage = await triageStoreRequest(req.rawBody);
      const canMoveStatus = ['pending_triage', 'needs_assistance'].includes(req.status);
      const nextStatus = canMoveStatus ? statusFromTriage(triage) : req.status;
      const updated = await prisma.storeRequest.update({
        where: { id: input.id },
        data: {
          triageResult: triage as any,
          ...(canMoveStatus ? { status: nextStatus } : {}),
        },
      });
      if (canMoveStatus && nextStatus === 'auto_running') {
        runPlaybook(input.id).catch((err) => console.error('runPlaybook failed', err));
      }
      return updated;
    }),

  // Manager+ : re-run the playbook on an existing request that's in auto_running
  // or auto_done (e.g. retry after a transient failure).
  runPlaybook: managerProcedure
    .input(z.object({ id: z.number() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const req = await prisma.storeRequest.findFirst({
        where: { id: input.id, teamId: ctx.teamId },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      // Reset to auto_running so the runner picks it up.
      await prisma.storeRequest.update({
        where: { id: input.id },
        data: { status: 'auto_running', runLog: null, closedAt: null },
      });
      runPlaybook(input.id).catch((err) => console.error('runPlaybook failed', err));
      return { ok: true };
    }),

  // Open iTerm at the store's workdir with `claude --continue` so the manager
  // takes over the agent's session for this specific request. iTerm opens on
  // the same Mac that runs the backend (your laptop). Local-only by design —
  // resumes the agent's last session, which carries the full materialized
  // context (.bouldhq/result.json, requests/, notes/, theme/).
  openTerminal: managerProcedure
    .input(z.object({ id: z.number() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const req = await prisma.storeRequest.findFirst({
        where: { id: input.id, teamId: ctx.teamId },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      const tag = await prisma.tag.findUnique({
        where: { id: req.tagId }, select: { name: true },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store tag not found' });
      try {
        await openRequestInAntigravity(tag.name, req.id);
      } catch (err: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err?.message || 'Could not open Antigravity IDE' });
      }
      return { ok: true };
    }),

  // Manager/founder: move a request through the status lifecycle.
  updateStatus: managerProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(STATUSES),
      managerNotes: z.string().optional(),
    }))
    .output(requestSchema)
    .mutation(async ({ ctx, input }) => {
      const req = await prisma.storeRequest.findFirst({
        where: { id: input.id, teamId: ctx.teamId },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      return prisma.storeRequest.update({
        where: { id: input.id },
        data: {
          status: input.status,
          ...(input.managerNotes !== undefined && { managerNotes: input.managerNotes }),
          ...(input.status === 'done' && { closedAt: new Date() }),
        },
      });
    }),

  assign: managerProcedure
    .input(z.object({ id: z.number(), assigneeId: z.number().nullable() }))
    .output(requestSchema)
    .mutation(async ({ ctx, input }) => {
      const req = await prisma.storeRequest.findFirst({
        where: { id: input.id, teamId: ctx.teamId },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      if (input.assigneeId !== null) {
        const member = await prisma.teamMember.findUnique({
          where: { teamId_accountId: { teamId: ctx.teamId, accountId: input.assigneeId } },
        });
        if (!member) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Assignee is not a team member' });
        }
      }
      return prisma.storeRequest.update({
        where: { id: input.id },
        data: { assigneeId: input.assigneeId },
      });
    }),

  // Triage setter — Phase 3 will call this from the AI router after running
  // the LLM classifier. Exposed here as a manager mutation for manual override.
  setTriage: managerProcedure
    .input(z.object({
      id: z.number(),
      triageResult: z.object({
        canAutomate: z.boolean(),
        reasoning: z.string(),
        suggestedAction: z.string().optional(),
      }),
    }))
    .output(requestSchema)
    .mutation(async ({ ctx, input }) => {
      const req = await prisma.storeRequest.findFirst({
        where: { id: input.id, teamId: ctx.teamId },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      return prisma.storeRequest.update({
        where: { id: input.id },
        data: {
          triageResult: input.triageResult,
          status: input.triageResult.canAutomate ? 'auto_running' : 'needs_assistance',
        },
      });
    }),

  // Open-count per tag — for the badge on store cards.
  openCountsByTag: teamMemberProcedure
    .input(z.void())
    .output(z.array(z.object({ tagId: z.number(), count: z.number() })))
    .query(async ({ ctx }) => {
      const rows = await prisma.storeRequest.groupBy({
        by: ['tagId'],
        where: {
          teamId: ctx.teamId,
          status: { notIn: ['done', 'auto_done'] },
          // Don't count open requests against archived stores.
          tag: { archivedAt: null },
        },
        _count: { _all: true },
      });
      return rows.map((r) => ({ tagId: r.tagId, count: r._count._all }));
    }),
});
