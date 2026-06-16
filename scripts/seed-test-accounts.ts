// Manage BouldHQ team-member accounts (idempotent).
//
// Default behavior:
//   - Removes the historical -demo accounts if they exist.
//   - Ensures every entry in TEAM_USERS exists with the configured password
//     and is a member of team BouldHQ with the configured role.
//
// Re-running is safe — it will reset passwords for everyone in TEAM_USERS so
// you always know what they are, but won't touch any other accounts.
//
// Run with:   bun run scripts/seed-test-accounts.ts

import { PrismaClient } from '@prisma/client';
import { randomBytes, pbkdf2 } from 'crypto';

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    pbkdf2(password, salt, 1000, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      resolve('pbkdf2:' + salt + ':' + derivedKey.toString('hex'));
    });
  });
}

const TEAM_SLUG = 'bouldhq';

type TeamUser = {
  name: string;         // login handle
  nickname: string;     // display name
  password: string;
  role: 'founder' | 'manager' | 'salesman';
  accountRole: 'user' | 'superadmin';
};

const TEAM_USERS: TeamUser[] = [
  { name: 'JakeK', nickname: 'Jake K', password: 'bouldhq2026', role: 'founder', accountRole: 'superadmin' },
];

// Login handles of accounts we want explicitly removed before re-seeding. If
// they don't exist, no-op. Cascades clean up their team memberships.
const ACCOUNTS_TO_REMOVE = ['cofounder-demo', 'manager-demo', 'salesman-demo'];

async function main() {
  const prisma = new PrismaClient();

  const team = await prisma.team.findUnique({ where: { slug: TEAM_SLUG } });
  if (!team) {
    throw new Error(
      `Team with slug "${TEAM_SLUG}" not found. Did the Phase 0 migration run? ` +
      `Try \`bun run prisma:migrate:deploy\` first.`,
    );
  }

  // 1. Remove stale demo accounts. The teamMember -> account FK has onDelete:
  //    Cascade, so dropping the account drops the membership too.
  const removed: string[] = [];
  for (const name of ACCOUNTS_TO_REMOVE) {
    const acc = await prisma.accounts.findFirst({ where: { name } });
    if (!acc) continue;
    // Some related rows don't cascade (e.g. attachments.accountId is nullable
    // FK with no cascade). For safety we just null those out here.
    await prisma.attachments.updateMany({ where: { accountId: acc.id }, data: { accountId: null } });
    await prisma.teamMember.deleteMany({ where: { accountId: acc.id } });
    await prisma.accounts.delete({ where: { id: acc.id } });
    removed.push(name);
  }

  // 2. Upsert each TEAM_USERS entry.
  const results: Array<{ name: string; accountId: number; created: boolean; role: string }> = [];
  for (const u of TEAM_USERS) {
    const passwordHash = await hashPassword(u.password);
    const existing = await prisma.accounts.findFirst({ where: { name: u.name } });

    const account = existing
      ? await prisma.accounts.update({
          where: { id: existing.id },
          data: { password: passwordHash, nickname: u.nickname, role: u.accountRole },
        })
      : await prisma.accounts.create({
          data: { name: u.name, nickname: u.nickname, password: passwordHash, role: u.accountRole },
        });

    await prisma.teamMember.upsert({
      where: { teamId_accountId: { teamId: team.id, accountId: account.id } },
      update: { role: u.role },
      create: { teamId: team.id, accountId: account.id, role: u.role },
    });

    results.push({ name: u.name, accountId: account.id, created: !existing, role: u.role });
  }

  // 3. Print final team state for sanity.
  const members = await prisma.teamMember.findMany({
    where: { teamId: team.id },
    include: { account: { select: { id: true, name: true, nickname: true, role: true } } },
    orderBy: { id: 'asc' },
  });

  console.log('Removed:', removed.length ? removed.join(', ') : '(none)');
  console.log('Team:', team.name, `(slug=${team.slug}, id=${team.id})`);
  console.log('Members:');
  for (const m of members) {
    console.log(
      `  - ${m.account.name.padEnd(20)} role=${m.role.padEnd(10)} ` +
      `accountRole=${m.account.role || '(none)'} id=${m.account.id}`,
    );
  }
  console.log('');
  console.log('Seeded credentials:');
  for (const u of TEAM_USERS) {
    console.log(`  ${u.name.padEnd(16)} password=${u.password}`);
  }
  console.log('');
  console.log('Seed summary:', results);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('seed-test-accounts failed:', err);
  process.exit(1);
});
