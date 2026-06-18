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

// Same as above but for the credentials-based login (no token in URL). The
// merchant can bookmark this and sign in any time with the username + password
// the staff shared with them.
export function buildOwnerLoginUrl(base?: string): string {
  const root = base
    || process.env.BOULDHQ_PUBLIC_URL
    || 'https://hq.bouldhq.com';
  return `${root.replace(/\/+$/, '')}/owner/login`;
}

// Generates a memorable username (slugified store name, with collision suffix
// if needed) and a random readable password. Caller hashes the password before
// persisting and shows the plaintext to the salesman exactly once.
//
// `takenNames` is checked against `accounts.name`. We try the bare slug first
// so most stores get a clean username like "adophies"; only on collision do we
// append a short suffix.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no 0/O/l/1/I
const USERNAME_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function slugifyStoreName(storeName: string): string {
  return storeName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'store';
}

function randomFromAlphabet(alphabet: string, length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export type GeneratedCredentials = { username: string; password: string };

export function generateBrandOwnerCredentials(
  storeName: string,
  isUsernameTaken: (candidate: string) => Promise<boolean>,
): Promise<GeneratedCredentials> {
  return (async () => {
    const base = slugifyStoreName(storeName);
    let username = base;
    let attempt = 0;
    while (await isUsernameTaken(username)) {
      attempt++;
      if (attempt > 5) {
        username = `${base}-${randomFromAlphabet(USERNAME_ALPHABET, 6)}`;
        break;
      }
      username = `${base}-${randomFromAlphabet(USERNAME_ALPHABET, 4)}`;
    }
    const password = randomFromAlphabet(PASSWORD_ALPHABET, 16);
    return { username, password };
  })();
}

// Same generator without a username — for password resets where the username
// stays the same but the password is rolled.
export function generateBrandOwnerPassword(): string {
  return randomFromAlphabet(PASSWORD_ALPHABET, 16);
}
