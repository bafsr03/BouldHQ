import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@server/prisma';
import {
  router,
  authProcedure,
  teamMemberProcedure,
  managerProcedure,
  founderProcedure,
  type TeamRole,
} from '@server/middleware';

const ROLES = ['founder', 'manager', 'salesman'] as const;

const teamSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const memberSchema = z.object({
  id: z.number(),
  teamId: z.number(),
  accountId: z.number(),
  role: z.enum(ROLES),
  createdAt: z.date(),
  account: z.object({
    id: z.number(),
    name: z.string(),
    nickname: z.string(),
    image: z.string(),
  }),
});

export const teamRouter = router({
  // Teams the caller belongs to, with their role on each.
  myTeams: authProcedure
    .input(z.void())
    .output(
      z.array(teamSchema.extend({ role: z.enum(ROLES) })),
    )
    .query(async ({ ctx }) => {
      const memberships = await prisma.teamMember.findMany({
        where: { accountId: Number(ctx.id) },
        include: { team: true },
        orderBy: { createdAt: 'asc' },
      });
      return memberships.map((m) => ({ ...m.team, role: m.role as TeamRole }));
    }),

  // Active team for the current request (used to size sidebar / header context).
  current: teamMemberProcedure
    .input(z.void())
    .output(teamSchema.extend({ role: z.enum(ROLES) }))
    .query(async ({ ctx }) => {
      const team = await prisma.team.findUnique({ where: { id: ctx.teamId } });
      if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
      return { ...team, role: ctx.teamRole };
    }),

  // List members of a team. Caller must be a member of that team.
  members: teamMemberProcedure
    .input(z.object({ teamId: z.number().optional() }))
    .output(z.array(memberSchema))
    .query(async ({ ctx, input }) => {
      const targetTeamId = input.teamId ?? ctx.teamId;
      // Founders can read any team; everyone else only their active team.
      if (targetTeamId !== ctx.teamId && ctx.teamRole !== 'founder') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot read members of another team' });
      }
      const rows = await prisma.teamMember.findMany({
        where: { teamId: targetTeamId },
        include: {
          account: { select: { id: true, name: true, nickname: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => ({ ...r, role: r.role as TeamRole }));
    }),

  // Manager/founder: invite an existing account into the team with a role.
  // (Account creation happens via the existing /signup flow; invite ties them.)
  invite: managerProcedure
    .input(z.object({ accountId: z.number(), role: z.enum(ROLES) }))
    .output(memberSchema)
    .mutation(async ({ ctx, input }) => {
      // Salesman cannot be invited as founder by a non-founder.
      if (input.role === 'founder' && ctx.teamRole !== 'founder') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only founders can grant founder role' });
      }
      const account = await prisma.accounts.findUnique({ where: { id: input.accountId } });
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });

      const existing = await prisma.teamMember.findUnique({
        where: { teamId_accountId: { teamId: ctx.teamId, accountId: input.accountId } },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Account is already a member of this team' });
      }

      const member = await prisma.teamMember.create({
        data: { teamId: ctx.teamId, accountId: input.accountId, role: input.role },
        include: {
          account: { select: { id: true, name: true, nickname: true, image: true } },
        },
      });
      return { ...member, role: member.role as TeamRole };
    }),

  // Founder only: change a member's role.
  updateRole: founderProcedure
    .input(z.object({ accountId: z.number(), role: z.enum(ROLES) }))
    .output(memberSchema)
    .mutation(async ({ ctx, input }) => {
      // Cannot demote yourself if you are the only founder.
      if (input.accountId === Number(ctx.id) && input.role !== 'founder') {
        const otherFounders = await prisma.teamMember.count({
          where: { teamId: ctx.teamId, role: 'founder', accountId: { not: Number(ctx.id) } },
        });
        if (otherFounders === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot demote the only founder of this team',
          });
        }
      }
      const updated = await prisma.teamMember.update({
        where: { teamId_accountId: { teamId: ctx.teamId, accountId: input.accountId } },
        data: { role: input.role },
        include: {
          account: { select: { id: true, name: true, nickname: true, image: true } },
        },
      });
      return { ...updated, role: updated.role as TeamRole };
    }),

  // Founder only: remove a member from the team. Cannot remove the last founder.
  removeMember: founderProcedure
    .input(z.object({ accountId: z.number() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.accountId === Number(ctx.id)) {
        const otherFounders = await prisma.teamMember.count({
          where: { teamId: ctx.teamId, role: 'founder', accountId: { not: Number(ctx.id) } },
        });
        if (otherFounders === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot remove the only founder',
          });
        }
      }
      await prisma.teamMember.delete({
        where: { teamId_accountId: { teamId: ctx.teamId, accountId: input.accountId } },
      });
      return { ok: true };
    }),

  // Persist the user's active team across sessions. Verifies membership first.
  switchActive: authProcedure
    .input(z.object({ teamId: z.number() }))
    .output(z.object({ ok: z.boolean(), teamId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.teamMember.findUnique({
        where: { teamId_accountId: { teamId: input.teamId, accountId: Number(ctx.id) } },
      });
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of that team' });
      }
      await prisma.accounts.update({
        where: { id: Number(ctx.id) },
        data: { lastActiveTeamId: input.teamId },
      });
      return { ok: true, teamId: input.teamId };
    }),

  // Founder only: create a new team. They become founder of it automatically.
  create: founderProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
      description: z.string().optional(),
    }))
    .output(teamSchema)
    .mutation(async ({ ctx, input }) => {
      const team = await prisma.team.create({ data: input });
      await prisma.teamMember.create({
        data: { teamId: team.id, accountId: Number(ctx.id), role: 'founder' },
      });
      return team;
    }),
});
