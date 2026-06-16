/**
 * This is your entry point to setup the root configuration for tRPC on the server.
 * - `initTRPC` should only be used once per app.
 * - We export only the functionality that we use so we can enforce which base procedures should be used
 *
 * Learn how to create protected base procedures and other things below:
 * @link https://trpc.io/docs/v11/router
 * @link https://trpc.io/docs/v11/procedures
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from '../context';
import superjson from 'superjson'
import { OpenApiMeta } from 'trpc-to-openapi';
import { prisma } from '@server/prisma';

export type TeamRole = 'founder' | 'manager' | 'salesman';

// Resolve the user's active team. Prefer accounts.lastActiveTeamId (persisted
// across sessions via team.switchActive). Fall back to most-recent membership
// for users who haven't switched yet.
export async function getActiveTeamMembership(accountId: number) {
  const account = await prisma.accounts.findUnique({
    where: { id: accountId },
    select: { lastActiveTeamId: true },
  });
  if (account?.lastActiveTeamId) {
    const pref = await prisma.teamMember.findUnique({
      where: { teamId_accountId: { teamId: account.lastActiveTeamId, accountId } },
    });
    if (pref) return pref;
  }
  return prisma.teamMember.findFirst({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
  });
}

export const t = initTRPC.context<Context>().meta<OpenApiMeta>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const authProcedure = t.procedure.use(async ({ ctx, next, path }) => {
  //@ts-ignore
  if (!ctx?.name || ctx?.requiresTwoFactor) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: 'Unauthorized'
    })
  }
  if (ctx.permissions && Array.isArray(ctx.permissions)) {
    const hasPermission = ctx.permissions.some(perm => path?.includes(perm));
    if (!hasPermission) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: 'This token does not have permission to access this endpoint'
      });
    }
  }

  return next({
    ctx,
    ...{ id: ctx.sub }
  })
})


export const demoAuthMiddleware = t.middleware(async ({ ctx, next }) => {
  if (process.env.IS_DEMO) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: 'The operation is rejected because this is a demo environment'
    })
  }
  return next({
    ctx
  });
});

export const superAdminAuthMiddleware = t.middleware(async ({ ctx, next }) => {
  if (ctx.role !== 'superadmin') {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: 'You are not allowed to perform this operation'
    })
  }
  return next({
    ctx
  });
});


export const mergeRouters = t.mergeRouters;

// Requires the caller to be a member of any team. Augments ctx with
// `teamId` (their active team) and `teamRole`.
export const teamMemberProcedure = authProcedure.use(async ({ ctx, next }) => {
  const membership = await getActiveTeamMembership(Number(ctx.id));
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of any team' });
  }
  return next({
    ctx: { ...ctx, teamId: membership.teamId, teamRole: membership.role as TeamRole },
  });
});

// Manager-or-above on their active team.
export const managerProcedure = teamMemberProcedure.use(async ({ ctx, next }) => {
  if (ctx.teamRole !== 'manager' && ctx.teamRole !== 'founder') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Manager or founder access required' });
  }
  return next({ ctx });
});

// Founder of any team (global access).
export const founderProcedure = teamMemberProcedure.use(async ({ ctx, next }) => {
  if (ctx.teamRole !== 'founder') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Founder access required' });
  }
  return next({ ctx });
});

// Brand-owner procedure. Caller must have role='brand_owner' in JWT, AND a
// brandOwner row pointing at a tag. Augments ctx with `tagId` (their single
// store) + `ownerId` (the brandOwner row).
export const brandOwnerProcedure = authProcedure.use(async ({ ctx, next }) => {
  if (ctx.role !== 'brand_owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Brand owner access required' });
  }
  const owner = await prisma.brandOwner.findFirst({
    where: { accountId: Number(ctx.id) },
    select: { id: true, tagId: true },
  });
  if (!owner) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No store linked to this owner account' });
  }
  return next({
    ctx: { ...ctx, tagId: owner.tagId, ownerId: owner.id },
  });
});