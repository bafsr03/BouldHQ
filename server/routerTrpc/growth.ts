import { router, teamMemberProcedure, managerProcedure } from '../middleware';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '../prisma';
import {
  BLUEPRINTS,
  isBlueprintType,
  isKnownTask,
  type BlueprintType,
  type GrowthScope,
} from '@shared/lib/growthBlueprints';

// BouldHQ Growth Engine — the accountability tracker behind /growth.
//
// State is team-scoped, not per-user: two people ticking boxes are working the
// same board. Every mutation touches exactly one check row, so concurrent edits
// merge instead of clobbering (which a single JSON blob would not).
//
// tagId 0 is the sentinel for "the agency's own tracks". Everything else is a
// store tag that must belong to the caller's active team.

/** tagId used for Bould's own tracks, which have no store tag behind them. */
const AGENCY_TAG_ID = 0;

const scopeSchema = z.enum(['agency', 'weekly', 'store', 'monthly']);
const blueprintSchema = z.enum(['dtc', 'local', 'b2b', 'resale']);

/** Today as YYYY-MM-DD, in the server's local timezone. */
const todayStamp = () => new Date().toISOString().slice(0, 10);
/** This month as YYYY-MM. */
const monthStamp = () => new Date().toISOString().slice(0, 7);

/**
 * Throws unless `tagId` is a store in the caller's active team. Archived stores
 * are allowed through — you can still read and close out their growth work.
 */
async function assertStoreInTeam(tagId: number, teamId: number): Promise<void> {
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, teamId, parent: 0 },
    select: { id: true },
  });
  if (!tag) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found in your team' });
  }
}

/** True when `taskId` is one of the tasks in this archetype's blueprint. */
function blueprintHasTask(type: BlueprintType, taskId: string): boolean {
  return BLUEPRINTS[type].some((block) => block.tasks.some((task) => task.id === taskId));
}

export const growthRouter = router({
  // Full board state for the active team. The client joins this against
  // storeProfile.list for names and logos rather than duplicating them here.
  state: teamMemberProcedure
    .input(z.void())
    .query(async ({ ctx }) => {
      const teamId = ctx.teamId;
      const [checks, tracks] = await Promise.all([
        prisma.growthCheck.findMany({
          where: { teamId },
          select: { tagId: true, scope: true, taskId: true },
        }),
        prisma.growthTrack.findMany({
          where: { teamId },
          select: { tagId: true, blueprint: true, cycleStart: true },
        }),
      ]);

      const agencyTrack = tracks.find((t) => t.tagId === AGENCY_TAG_ID);
      const pick = (tagId: number, scope: GrowthScope) =>
        checks.filter((c) => c.tagId === tagId && c.scope === scope).map((c) => c.taskId);

      return {
        // Stamped by "Start new week". Empty until the first reset.
        weekStart: agencyTrack?.cycleStart ?? '',
        agencyChecks: pick(AGENCY_TAG_ID, 'agency'),
        weeklyChecks: pick(AGENCY_TAG_ID, 'weekly'),
        // Only stores someone has explicitly put on a blueprint. Untracked
        // stores are offered in the UI from the store list instead.
        tracks: tracks
          .filter((t) => t.tagId !== AGENCY_TAG_ID && isBlueprintType(t.blueprint))
          .map((t) => ({
            tagId: t.tagId,
            blueprint: t.blueprint as BlueprintType,
            monthStart: t.cycleStart,
            checks: pick(t.tagId, 'store'),
            monthly: pick(t.tagId, 'monthly'),
          })),
      };
    }),

  // Tick / untick one box. Unchecking deletes the row, so the table only ever
  // holds real progress and `state` needs no "false" entries.
  setCheck: teamMemberProcedure
    .input(z.object({
      tagId: z.number().int().min(0).default(AGENCY_TAG_ID),
      scope: scopeSchema,
      taskId: z.string().max(40),
      checked: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { scope, taskId, checked } = input;
      const teamId = ctx.teamId;
      const isAgencyScope = scope === 'agency' || scope === 'weekly';
      const tagId = isAgencyScope ? AGENCY_TAG_ID : input.tagId;

      if (!isAgencyScope) {
        if (tagId === AGENCY_TAG_ID) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Store scope requires a store' });
        }
        await assertStoreInTeam(tagId, teamId);
      }

      // Reject unknown ids outright: a stale client must not be able to write
      // rows that no reset ever clears and no view ever shows.
      if (!isKnownTask(scope, taskId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown ${scope} task "${taskId}"` });
      }

      if (scope === 'store') {
        const track = await prisma.growthTrack.findUnique({
          where: { teamId_tagId: { teamId, tagId } },
          select: { blueprint: true },
        });
        if (!track || !isBlueprintType(track.blueprint)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Store is not on a blueprint yet' });
        }
        if (!blueprintHasTask(track.blueprint, taskId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Task "${taskId}" is not part of the ${track.blueprint} blueprint`,
          });
        }
      }

      if (checked) {
        await prisma.growthCheck.upsert({
          where: { teamId_tagId_scope_taskId: { teamId, tagId, scope, taskId } },
          create: { teamId, tagId, scope, taskId, checkedById: Number(ctx.id) },
          // Re-ticking an already-ticked box re-stamps who did it last.
          update: { checkedById: Number(ctx.id), checkedAt: new Date() },
        });
      } else {
        await prisma.growthCheck.deleteMany({ where: { teamId, tagId, scope, taskId } });
      }
      return { ok: true };
    }),

  // Monday reset: clear the weekly rhythm and stamp the new week.
  startNewWeek: teamMemberProcedure
    .input(z.void())
    .mutation(async ({ ctx }) => {
      const teamId = ctx.teamId;
      const weekStart = todayStamp();
      await prisma.$transaction([
        prisma.growthCheck.deleteMany({ where: { teamId, tagId: AGENCY_TAG_ID, scope: 'weekly' } }),
        prisma.growthTrack.upsert({
          where: { teamId_tagId: { teamId, tagId: AGENCY_TAG_ID } },
          create: { teamId, tagId: AGENCY_TAG_ID, blueprint: '', cycleStart: weekStart },
          update: { cycleStart: weekStart },
        }),
      ]);
      return { weekStart };
    }),

  // First-business-day reset: clear one store's monthly operating cycle.
  startNewMonth: teamMemberProcedure
    .input(z.object({ tagId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const teamId = ctx.teamId;
      await assertStoreInTeam(input.tagId, teamId);
      const track = await prisma.growthTrack.findUnique({
        where: { teamId_tagId: { teamId, tagId: input.tagId } },
        select: { id: true },
      });
      if (!track) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Store is not on a blueprint yet' });
      }
      const monthStart = monthStamp();
      await prisma.$transaction([
        prisma.growthCheck.deleteMany({ where: { teamId, tagId: input.tagId, scope: 'monthly' } }),
        prisma.growthTrack.update({ where: { id: track.id }, data: { cycleStart: monthStart } }),
      ]);
      return { monthStart };
    }),

  // Put a store on a blueprint, or move it to a different one. Switching keeps
  // the old blueprint's checks on file — task ids don't overlap between
  // archetypes, so switching back restores the previous progress intact.
  setBlueprint: teamMemberProcedure
    .input(z.object({ tagId: z.number().int().positive(), blueprint: blueprintSchema }))
    .mutation(async ({ input, ctx }) => {
      const teamId = ctx.teamId;
      await assertStoreInTeam(input.tagId, teamId);
      await prisma.growthTrack.upsert({
        where: { teamId_tagId: { teamId, tagId: input.tagId } },
        create: { teamId, tagId: input.tagId, blueprint: input.blueprint, cycleStart: '' },
        update: { blueprint: input.blueprint },
      });
      return { ok: true };
    }),

  // Remove a store from the board. Destructive — it drops every check for that
  // store — so it's manager+ only, matching how store archival is gated.
  untrack: managerProcedure
    .input(z.object({ tagId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const teamId = ctx.teamId;
      await assertStoreInTeam(input.tagId, teamId);
      await prisma.$transaction([
        prisma.growthCheck.deleteMany({ where: { teamId, tagId: input.tagId } }),
        prisma.growthTrack.deleteMany({ where: { teamId, tagId: input.tagId } }),
      ]);
      return { ok: true };
    }),
});
