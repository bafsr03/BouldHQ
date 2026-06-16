import { router, authProcedure, teamMemberProcedure, managerProcedure, founderProcedure } from '@server/middleware';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@server/prisma';
import { ensureBrandingFolderForTag, bootstrapStoreNotes } from '@server/lib/bouldhq';
import { createMagicLink, buildMagicLinkUrl } from '@server/lib/brandOwnerAuth';
import { randomBytes } from 'crypto';
import {
  workdirFor, themeDirFor, importFolderIntoWorkdir, openInIterm,
} from '@server/lib/opsConsole';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Pre-create the per-store workspace at ~/.bouldhq-workdirs/<name>/ when the
// store is created. Leaves a README so the user knows what to drop in.
async function ensureStoreWorkdir(storeName: string): Promise<void> {
  const root = process.env.BOULDHQ_WORKDIR_ROOT
    || path.join(os.homedir(), '.bouldhq-workdirs');
  const dir = path.join(root, storeName.toLowerCase().trim());
  await fs.mkdir(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  try { await fs.access(readme); return; } catch {}
  const lines = [
    `BouldHQ workspace for: ${storeName}`,
    '',
    'This folder is where the BouldHQ agent looks for everything related to',
    'this store. Two things should live here once it\'s fully set up:',
    '',
    '  1. The Shopify theme export — drag in the entire `theme_export__*` ',
    '     folder you downloaded from Shopify (or pulled with `shopify theme',
    '     pull`). It must be a git checkout (have a `.git` directory) and',
    '     pushed to a GitHub repo connected to this Shopify store via the',
    '     Shopify "Themes from GitHub" integration. Pushes to `main` deploy.',
    '',
    '  2. Whatever else you work on for the store — design files, 3D models,',
    '     reference images, screenshots, voice memos. The agent reads these',
    '     as context but never modifies them.',
    '',
    'When a request comes in:',
    '',
    '  - BouldHQ regenerates `.bouldhq/` here with the request body + the',
    '    team\'s notes about this store. Do not edit those files.',
    '  - The agent finds the most recent `theme_export__*/` and works in it.',
    '  - If you want to override the agent\'s instructions for this store,',
    '    edit the `CLAUDE.md` at the root of this folder.',
  ];
  await fs.writeFile(readme, lines.join('\n') + '\n', 'utf8');
}

const SHOPIFY_PLANS = ['', 'Starter', 'Basic', 'Shopify', 'Advanced', 'Plus'] as const;

const storeProfileSchema = z.object({
  id: z.number(),
  tagId: z.number(),
  accountId: z.number(),
  storeUrl: z.string(),
  collabAccess: z.boolean(),
  shopifyPlan: z.string(),
  adminUrl: z.string(),
  collaboratorCode: z.string(),
  logoPath: z.string(),
  localThemePath: z.string(),
  devServerPort: z.number(),
  renewalDate: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// A store profile is readable/writable by any member of the team that owns the
// tag. `accountId` on the row remains the creator (audit only); not used for scope.
async function ensureTagInMyTeam(tagId: number, accountId: number): Promise<number> {
  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    select: { teamId: true },
  });
  if (!tag?.teamId) {
    throw new Error('Tag is not associated with a team');
  }
  const member = await prisma.teamMember.findFirst({
    where: { accountId, teamId: tag.teamId },
    select: { id: true },
  });
  if (!member) {
    throw new Error('You are not a member of the team that owns this store');
  }
  return tag.teamId;
}

export const storeProfileRouter = router({
  // Lightweight info about a store regardless of archive state — used by the
  // store detail page so it can show an archived banner / restore button.
  archiveStatus: teamMemberProcedure
    .input(z.object({ tagId: z.number() }))
    .output(z.object({
      tagId: z.number(),
      name: z.string(),
      archivedAt: z.date().nullable(),
      archivedById: z.number().nullable(),
    }))
    .query(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
        select: { id: true, name: true, archivedAt: true, archivedById: true },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found in your team' });
      return { tagId: tag.id, name: tag.name, archivedAt: tag.archivedAt, archivedById: tag.archivedById };
    }),

  byTagId: authProcedure
    .input(z.object({ tagId: z.number() }))
    .output(storeProfileSchema.nullable())
    .query(async ({ input, ctx }) => {
      // Read access is scoped via team membership through the tag.
      try {
        await ensureTagInMyTeam(input.tagId, Number(ctx.id));
      } catch {
        return null;
      }
      return prisma.storeProfile.findFirst({ where: { tagId: input.tagId } });
    }),

  list: teamMemberProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }).optional())
    .output(z.array(storeProfileSchema.extend({
      tagName: z.string(),
      archivedAt: z.date().nullable(),
    })))
    .query(async ({ ctx, input }) => {
      // Every store in the caller's active team. Archived stores are hidden
      // unless explicitly requested.
      const includeArchived = input?.includeArchived ?? false;
      const rows = await prisma.storeProfile.findMany({
        where: {
          tag: {
            teamId: ctx.teamId,
            ...(includeArchived ? {} : { archivedAt: null }),
          },
        },
        include: { tag: { select: { name: true, archivedAt: true } } },
        orderBy: [
          { tag: { archivedAt: 'asc' } },  // active first (NULL sorts first in asc)
          { tag: { name: 'asc' } },
        ],
      });
      return rows.map((r) => ({
        ...r,
        tagName: r.tag.name,
        archivedAt: r.tag.archivedAt,
      }));
    }),

  // Onboard a new store. Atomic: tag + storeProfile + branding folder + (optional)
  // first storeRequest with the salesman's pasted requirements. Returns the new
  // tagId so the wizard can redirect to /stores/:tagId.
  createStore: teamMemberProcedure
    .input(z.object({
      name: z.string().min(1).max(100).regex(/^[^\s#/][^#/]*$/, 'No spaces, #, or / in store name'),
      storeUrl: z.string().max(500).default(''),
      collabAccess: z.boolean().default(false),
      shopifyPlan: z.enum(SHOPIFY_PLANS).default(''),
      adminUrl: z.string().max(500).default(''),
      collaboratorCode: z.string().max(20).default(''),
      logoPath: z.string().max(500).default(''),
      renewalDate: z.coerce.date().nullable().optional(),
      initialRequest: z.object({
        source: z.enum(['text', 'email', 'screenshot', 'voice']),
        rawBody: z.string().min(1),
      }).optional(),
    }))
    .output(z.object({
      tagId: z.number(),
      storeProfileId: z.number(),
      initialRequestId: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);

      const existing = await prisma.tag.findFirst({
        where: { teamId: ctx.teamId, parent: 0, name: input.name },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A store named "${input.name}" already exists in this team`,
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const tag = await tx.tag.create({
          data: {
            name: input.name,
            parent: 0,
            accountId,
            teamId: ctx.teamId,
          },
        });

        const profile = await tx.storeProfile.create({
          data: {
            tagId: tag.id,
            accountId,
            storeUrl: input.storeUrl,
            collabAccess: input.collabAccess,
            shopifyPlan: input.shopifyPlan,
            adminUrl: input.adminUrl,
            collaboratorCode: input.collaboratorCode,
            logoPath: input.logoPath,
            renewalDate: input.renewalDate ?? null,
          },
        });

        let initialRequestId: number | null = null;
        if (input.initialRequest) {
          const req = await tx.storeRequest.create({
            data: {
              teamId: ctx.teamId,
              tagId: tag.id,
              createdById: accountId,
              source: input.initialRequest.source,
              rawBody: input.initialRequest.rawBody,
              attachmentIds: [],
              status: 'pending_triage',
            },
          });
          initialRequestId = req.id;
        }

        return { tagId: tag.id, storeProfileId: profile.id, initialRequestId };
      });

      // Side effects outside the txn — all idempotent. Failure doesn't roll back the store.
      ensureBrandingFolderForTag(accountId, input.name)
        .catch((e) => console.error('ensureBrandingFolder createStore', e));
      bootstrapStoreNotes(accountId, result.tagId, input.name)
        .catch((e) => console.error('bootstrapStoreNotes createStore', e));
      ensureStoreWorkdir(input.name)
        .catch((e) => console.error('ensureStoreWorkdir createStore', e));

      return result;
    }),

  // Manager+ : invite the brand owner. Creates (or reuses) an `accounts` row
  // with role='brand_owner', links it to the store via the brandOwner table,
  // and mints a 15-min magic link. Returns the URL so the salesman can share
  // it via iMessage / SMS from their iPad. Calling again on the same store
  // mints a fresh link without recreating the owner.
  inviteBrandOwner: managerProcedure
    .input(z.object({
      tagId: z.number(),
      email: z.string().email(),
      name: z.string().min(1),
      phone: z.string().optional(),
    }))
    .output(z.object({
      ownerId: z.number(),
      accountId: z.number(),
      magicLinkUrl: z.string(),
      expiresAt: z.date(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Tag must be a store on the caller's team.
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
        select: { id: true, name: true },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found in your team' });

      const normalizedEmail = input.email.toLowerCase().trim();

      // Find or create the underlying account row. Email goes in `name` (we
      // reuse Blinko's auth identity scheme; brand owners don't use a
      // username/password). Random password — never used.
      let account = await prisma.accounts.findFirst({ where: { name: normalizedEmail } });
      if (!account) {
        account = await prisma.accounts.create({
          data: {
            name: normalizedEmail,
            nickname: input.name,
            password: randomBytes(32).toString('hex'),    // unusable but non-empty
            role: 'brand_owner',
          },
        });
      } else if (account.role !== 'brand_owner') {
        // Existing staff/superadmin account — refuse rather than silently demote.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `An account already exists with email ${normalizedEmail} but is not a brand owner.`,
        });
      } else if (account.nickname !== input.name) {
        account = await prisma.accounts.update({
          where: { id: account.id },
          data: { nickname: input.name },
        });
      }

      // Bind to the store. Upsert keeps phone / invitedBy fresh.
      const owner = await prisma.brandOwner.upsert({
        where: { tagId: input.tagId },
        update: {
          accountId: account.id,
          phone: input.phone ?? null,
          invitedById: Number(ctx.id),
        },
        create: {
          accountId: account.id,
          tagId: input.tagId,
          phone: input.phone ?? null,
          invitedById: Number(ctx.id),
        },
      });

      const link = await createMagicLink(owner.id);
      return {
        ownerId: owner.id,
        accountId: account.id,
        magicLinkUrl: buildMagicLinkUrl(link.rawToken),
        expiresAt: link.expiresAt,
      };
    }),

  // Manager+ : refresh the link for an already-invited owner. Useful when the
  // previous link expired before the merchant clicked it.
  resendBrandOwnerLink: managerProcedure
    .input(z.object({ tagId: z.number() }))
    .output(z.object({ magicLinkUrl: z.string(), expiresAt: z.date() }))
    .mutation(async ({ ctx, input }) => {
      const owner = await prisma.brandOwner.findUnique({
        where: { tagId: input.tagId },
        include: { tag: { select: { teamId: true } } },
      });
      if (!owner || owner.tag.teamId !== ctx.teamId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No brand owner invited yet for that store' });
      }
      const link = await createMagicLink(owner.id);
      return { magicLinkUrl: buildMagicLinkUrl(link.rawToken), expiresAt: link.expiresAt };
    }),

  // Manager+ : soft-archive a store. Reversible via unarchive.
  // Notes stay tagged with the store — they remain readable at /stores/:tagId.
  archive: managerProcedure
    .input(z.object({ tagId: z.number() }))
    .output(z.object({ ok: z.boolean(), archivedAt: z.date() }))
    .mutation(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found in your team' });
      const updated = await prisma.tag.update({
        where: { id: input.tagId },
        data: { archivedAt: new Date(), archivedById: Number(ctx.id) },
      });
      return { ok: true, archivedAt: updated.archivedAt! };
    }),

  unarchive: managerProcedure
    .input(z.object({ tagId: z.number() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found in your team' });
      await prisma.tag.update({
        where: { id: input.tagId },
        data: { archivedAt: null, archivedById: null },
      });
      return { ok: true };
    }),

  // Founder-only: hard-delete a store. Requires typed-name confirmation to
  // prevent accidents. Cascades the tag → storeProfile, storeRequest, and now
  // soft-deletes (isRecycle=true) any notes that were attached to the store
  // so they don't orphan onto the founder's personal feed. Founders can still
  // restore them from trash if needed.
  deletePermanently: founderProcedure
    .input(z.object({ tagId: z.number(), confirmName: z.string() }))
    .output(z.object({
      ok: z.boolean(),
      deletedRequests: z.number(),
      recycledNotes: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
        include: { _count: { select: { storeRequests: true } } },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found in your team' });
      if (input.confirmName !== tag.name) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Confirmation must match the store name exactly ("${tag.name}")`,
        });
      }

      const deletedRequests = tag._count.storeRequests;

      // Sub-tags of this store (e.g. Branding Assets/<store>/foo) — also unlink.
      const subTagIds = (await prisma.tag.findMany({
        where: { teamId: ctx.teamId, parent: tag.id },
        select: { id: true },
      })).map((t) => t.id);
      const allTagIds = [tag.id, ...subTagIds];

      // Collect every note attached to this store (or its sub-tags) BEFORE we
      // drop the relations — once tagsToNote is gone we can't find them.
      const noteIds = Array.from(new Set(
        (await prisma.tagsToNote.findMany({
          where: { tagId: { in: allTagIds } },
          select: { noteId: true },
        })).map((r) => r.noteId),
      ));

      await prisma.$transaction([
        // Recycle the notes regardless of who created them. They're store
        // content, owned by the team; founder hard-deletes the store, so the
        // team's content goes to trash with it.
        prisma.notes.updateMany({
          where: { id: { in: noteIds } },
          data: { isRecycle: true, isTop: false },
        }),
        prisma.tagsToNote.deleteMany({ where: { tagId: { in: allTagIds } } }),
        prisma.tag.deleteMany({ where: { id: { in: subTagIds } } }),
        prisma.tag.delete({ where: { id: tag.id } }),
        // storeProfile + storeRequests cascade via their FK onDelete: Cascade.
      ]);

      return { ok: true, deletedRequests, recycledNotes: noteIds.length };
    }),

  upsert: authProcedure
    .input(z.object({
      tagId: z.number(),
      storeUrl: z.string().max(500).optional(),
      collabAccess: z.boolean().optional(),
      shopifyPlan: z.enum(SHOPIFY_PLANS).optional(),
      adminUrl: z.string().max(500).optional(),
      collaboratorCode: z.string().max(20).optional(),
      logoPath: z.string().max(500).optional(),
      localThemePath: z.string().max(500).optional(),
      devServerPort: z.number().int().min(1).max(65535).optional(),
      renewalDate: z.coerce.date().nullable().optional(),
    }))
    .output(storeProfileSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      await ensureTagInMyTeam(input.tagId, accountId);

      const data = {
        storeUrl: input.storeUrl,
        collabAccess: input.collabAccess,
        shopifyPlan: input.shopifyPlan,
        adminUrl: input.adminUrl,
        collaboratorCode: input.collaboratorCode,
        logoPath: input.logoPath,
        localThemePath: input.localThemePath,
        devServerPort: input.devServerPort,
        renewalDate: input.renewalDate,
      };
      const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

      return prisma.storeProfile.upsert({
        where: { tagId: input.tagId },
        create: { tagId: input.tagId, accountId, ...cleanData },
        update: cleanData,
      });
    }),

  // BouldHQ Phase 9 — Ops Console endpoints.
  //
  // Read-only: where does this store live on disk, and does it exist yet?
  connectInfo: managerProcedure
    .input(z.object({ tagId: z.number() }))
    .output(z.object({
      storeName: z.string(),
      workdir: z.string(),
      themeDir: z.string(),
      themeDirExists: z.boolean(),
      themeSource: z.enum(['explicit', 'theme_export', 'workdir', 'missing']),
      previewUrl: z.string(),
      storeUrl: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      const profile = await prisma.storeProfile.findFirst({ where: { tagId: input.tagId } });
      const { themeDir, source } = await themeDirFor(tag.name, profile?.localThemePath ?? '');
      const themeDirExists = source !== 'missing'
        && !!(await fs.stat(themeDir).catch(() => null));
      return {
        storeName: tag.name,
        workdir: workdirFor(tag.name),
        themeDir,
        themeDirExists,
        themeSource: source,
        previewUrl: `http://127.0.0.1:${profile?.devServerPort ?? 9292}`,
        storeUrl: profile?.storeUrl ?? '',
      };
    }),

  // Launches iTerm with the two-pane layout. The server runs on the manager's
  // own machine, so it can drive AppleScript locally. Returns the preview URL
  // the caller should open after a delay to give shopify theme dev time to boot.
  openInTerminal: managerProcedure
    .input(z.object({ tagId: z.number() }))
    .output(z.object({ ok: z.boolean(), previewUrl: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });
      const profile = await prisma.storeProfile.findFirst({ where: { tagId: input.tagId } });
      const { themeDir } = await themeDirFor(tag.name, profile?.localThemePath ?? '');

      try {
        await openInIterm(themeDir, tag.name, profile?.storeUrl ?? undefined);
      } catch (err: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err?.message ?? 'Failed to launch iTerm',
        });
      }
      return { ok: true, previewUrl: `http://127.0.0.1:${profile?.devServerPort ?? 9292}` };
    }),

  // Copy a folder from anywhere under the manager's home dir into the
  // centralized workdir for this store. Idempotent (rsync -a without --delete).
  importFromLocalPath: managerProcedure
    .input(z.object({ tagId: z.number(), sourcePath: z.string().min(1).max(1000) }))
    .output(z.object({
      ok: z.boolean(),
      workdir: z.string(),
      bytesCopied: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tag = await prisma.tag.findFirst({
        where: { id: input.tagId, teamId: ctx.teamId, parent: 0 },
      });
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store not found' });

      try {
        const result = await importFolderIntoWorkdir(input.sourcePath, tag.name);
        return { ok: true, workdir: result.workdir, bytesCopied: result.bytesCopied };
      } catch (err: any) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err?.message ?? 'Import failed' });
      }
    }),
});
