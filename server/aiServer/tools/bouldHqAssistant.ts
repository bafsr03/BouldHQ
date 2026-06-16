// BouldHQ Phase 5 — tools for the BouldHqAssistantAgent.
// Three things the AI can do:
//   1. findResource  — locate a saved attachment (SOP, template, branding asset, etc.)
//   2. listStores    — return the team's stores so the user can pick one
//   3. createTask    — open a storeRequest for the agent manager

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v3';
import { prisma } from '@server/prisma';
import { verifyToken } from '@server/lib/helper';

async function resolveCallerTeam(token: string | undefined, accountIdHint?: string) {
  const accountId = Number(accountIdHint ?? (await verifyToken(token!))?.sub);
  if (!accountId || Number.isNaN(accountId)) return null;
  const membership = await prisma.teamMember.findFirst({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
  });
  if (!membership) return { accountId, teamId: null as number | null, role: null as string | null };
  return { accountId, teamId: membership.teamId, role: membership.role };
}

export const findResourceTool = createTool({
  id: 'bouldhq-find-resource',
  description:
    'Search the user\'s Resources panel (attachments under SOPs, Onboarding Templates, AI Prompt Library, Branding Assets, Sales Documents, etc.) by name or folder. Returns the matching files with their paths, sizes, and folders.',
  //@ts-ignore
  inputSchema: z.object({
    query: z.string().min(1).describe('Substring to match in the file name. Case-insensitive.'),
    folder: z.string().optional().describe('Optional folder prefix to scope the search, e.g. "SOPs" or "Branding Assets".'),
    limit: z.number().default(15),
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const ctx = await resolveCallerTeam(context.token, runtimeContext?.get('accountId') as string | undefined);
    if (!ctx) return { success: false, message: 'Could not resolve caller' };

    const rows = await prisma.attachments.findMany({
      where: {
        accountId: ctx.accountId,
        type: { not: 'folder' },
        name: { contains: context.query, mode: 'insensitive' },
        ...(context.folder ? { perfixPath: { startsWith: context.folder } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: context.limit,
      select: {
        id: true, name: true, path: true, perfixPath: true,
        size: true, type: true, updatedAt: true,
      },
    });

    return {
      success: true,
      message: rows.length === 0 ? 'No resources matched.' : `Found ${rows.length} resource(s).`,
      resources: rows.map((r) => ({
        id: r.id,
        name: r.name,
        folder: r.perfixPath ?? '',
        path: r.path,
        size: Number(r.size),
        type: r.type,
        updatedAt: r.updatedAt,
      })),
    };
  },
});

export const listStoresTool = createTool({
  id: 'bouldhq-list-stores',
  description:
    'List every Shopify store the caller\'s team manages (each top-level tag). Use this to resolve a store name to its tagId before opening a task.',
  //@ts-ignore
  inputSchema: z.object({
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const ctx = await resolveCallerTeam(context.token, runtimeContext?.get('accountId') as string | undefined);
    if (!ctx?.teamId) return { success: false, message: 'You are not a member of any team.' };

    const stores = await prisma.tag.findMany({
      where: { teamId: ctx.teamId, parent: 0, archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return {
      success: true,
      message: `Team has ${stores.length} store(s).`,
      stores: stores.map((s) => ({ tagId: s.id, name: s.name })),
    };
  },
});

export const createTaskForManagerTool = createTool({
  id: 'bouldhq-create-task-for-manager',
  description:
    'Open a request for the agent manager against a store. Use this when the user says "save a task", "remind me to", "ask the manager to", or similar. If the user names a store but you don\'t know its tagId, call bouldhq-list-stores first.',
  //@ts-ignore
  inputSchema: z.object({
    tagId: z.number().describe('The store tagId. Resolve via bouldhq-list-stores if needed.'),
    body: z.string().min(1).describe('The full request, in the user\'s own words. Don\'t paraphrase — preserve specifics like names, dates, URLs, codes.'),
    source: z.enum(['text', 'email', 'screenshot', 'voice']).default('text'),
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const ctx = await resolveCallerTeam(context.token, runtimeContext?.get('accountId') as string | undefined);
    if (!ctx?.teamId) return { success: false, message: 'You are not a member of any team.' };

    const tag = await prisma.tag.findFirst({
      where: { id: context.tagId, teamId: ctx.teamId },
      select: { id: true, name: true },
    });
    if (!tag) return { success: false, message: 'That store does not belong to your team.' };

    const req = await prisma.storeRequest.create({
      data: {
        teamId: ctx.teamId,
        tagId: context.tagId,
        createdById: ctx.accountId,
        source: context.source,
        rawBody: context.body,
        attachmentIds: [],
        status: 'pending_triage',
      },
    });
    return {
      success: true,
      message: `Opened request #${req.id} for store "${tag.name}". AI triage will run automatically.`,
      requestId: req.id,
      storeName: tag.name,
    };
  },
});
