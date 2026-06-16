// Magic-link auth for brand owners. Salesman onboards a merchant → a 15-min
// link is generated → merchant taps it on their phone → we exchange the link
// for a 30-day JWT with role='brand_owner'. The same JWT cookie path the rest
// of the app uses works for owners too.

import crypto from 'crypto';
import { prisma } from '@server/prisma';
import { generateToken } from './helper';

const LINK_TTL_MS = 15 * 60 * 1000;       // 15 minutes
const TOKEN_BYTES = 32;                    // 256-bit random tokens

export type CreatedMagicLink = {
  rawToken: string;
  expiresAt: Date;
  ownerId: number;
};

// Returns the raw URL-safe token (only place it's ever exposed in plain text).
// Persists a sha256 of it so a DB leak can't be used to log in as the owner.
export async function createMagicLink(ownerId: number): Promise<CreatedMagicLink> {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);

  await prisma.brandOwnerMagicLink.create({
    data: { ownerId, tokenHash, expiresAt },
  });

  return { rawToken: raw, expiresAt, ownerId };
}

export type ConsumeResult =
  | { ok: true; jwt: string; tagId: number; accountId: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'no_owner' };

// Validates a raw token, marks it used, returns a 30-day session JWT. Single
// use — the second call with the same token will fail with 'used'.
export async function consumeMagicLink(rawToken: string): Promise<ConsumeResult> {
  if (!rawToken || typeof rawToken !== 'string') return { ok: false, reason: 'invalid' };
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const link = await prisma.brandOwnerMagicLink.findUnique({
    where: { tokenHash },
    include: { owner: { include: { account: true } } },
  });

  if (!link) return { ok: false, reason: 'invalid' };
  if (link.usedAt) return { ok: false, reason: 'used' };
  if (link.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (!link.owner?.account) return { ok: false, reason: 'no_owner' };

  await prisma.brandOwnerMagicLink.update({
    where: { id: link.id },
    data: { usedAt: new Date() },
  });
  await prisma.brandOwner.update({
    where: { id: link.ownerId },
    data: { updatedAt: new Date() },
  });

  const jwt = await generateToken({
    id: link.owner.account.id,
    name: link.owner.account.name,
    role: 'brand_owner',
  });

  return {
    ok: true,
    jwt,
    tagId: link.owner.tagId,
    accountId: link.owner.account.id,
  };
}

// Public URL the merchant taps. We point at the app root with a query param so
// React Router can route to the owner login page.
export function buildMagicLinkUrl(rawToken: string, base?: string): string {
  const root = base
    || process.env.BOULDHQ_PUBLIC_URL
    || 'https://hq.bouldhq.com';
  return `${root.replace(/\/+$/, '')}/owner/login?token=${encodeURIComponent(rawToken)}`;
}
