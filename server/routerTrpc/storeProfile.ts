import { router, authProcedure } from '@server/middleware';
import { z } from 'zod';
import { prisma } from '@server/prisma';

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
  renewalDate: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const storeProfileRouter = router({
  byTagId: authProcedure
    .input(z.object({ tagId: z.number() }))
    .output(storeProfileSchema.nullable())
    .query(async ({ input, ctx }) => {
      const profile = await prisma.storeProfile.findFirst({
        where: { tagId: input.tagId, accountId: Number(ctx.id) },
      });
      return profile;
    }),

  list: authProcedure
    .input(z.void())
    .output(z.array(storeProfileSchema))
    .query(async ({ ctx }) => {
      return prisma.storeProfile.findMany({
        where: { accountId: Number(ctx.id) },
      });
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
      renewalDate: z.coerce.date().nullable().optional(),
    }))
    .output(storeProfileSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = Number(ctx.id);
      const tag = await prisma.tag.findFirst({ where: { id: input.tagId, accountId } });
      if (!tag) throw new Error('Tag not found or not owned by user');

      const data = {
        storeUrl: input.storeUrl,
        collabAccess: input.collabAccess,
        shopifyPlan: input.shopifyPlan,
        adminUrl: input.adminUrl,
        collaboratorCode: input.collaboratorCode,
        logoPath: input.logoPath,
        renewalDate: input.renewalDate,
      };
      // strip undefined so we don't overwrite with null
      const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

      return prisma.storeProfile.upsert({
        where: { tagId: input.tagId },
        create: { tagId: input.tagId, accountId, ...cleanData },
        update: cleanData,
      });
    }),
});
