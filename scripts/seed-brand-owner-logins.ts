// Ensure every store on a team has a brand-owner login (the magic-link / password
// portal a merchant uses to see their own reports & requests).
//
// For each store missing an owner: creates an accounts row (role brand_owner),
// links it via the brandOwner table, and mints a fresh magic link — exactly what
// the storeProfile.inviteBrandOwner mutation does. Existing owners are left as-is
// (their saved password is preserved) and just get a fresh magic link, unless
// RESET_EXISTING=true is set to roll their password too.
//
// Prints a credentials table to hand to each client. Passwords are shown once.
//
// Run with:   bun --env-file ../.env scripts/seed-brand-owner-logins.ts
//
//   TEAM_SLUG=bouldhq              which team (default: bouldhq)
//   RESET_EXISTING=true           also roll passwords for owners that already exist
//   BOULDHQ_PUBLIC_URL=https://…  base URL used in the printed magic links

import path from 'path';

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

const TEAM_SLUG = process.env.TEAM_SLUG || 'bouldhq';
const RESET_EXISTING = process.env.RESET_EXISTING === 'true';

type Row = {
  store: string;
  username: string;
  password: string | null;   // null = unchanged (existing owner, not reset)
  magicLink: string;
  status: 'created' | 'existing' | 'reset';
};

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const {
    generateBrandOwnerCredentials,
    generateBrandOwnerPassword,
    createMagicLink,
    buildMagicLinkUrl,
    buildOwnerLoginUrl,
  } = await import('../server/lib/brandOwnerAuth');
  const { hashPassword } = await import('../prisma/seed');
  const prisma = new PrismaClient();

  try {
    const team = await prisma.team.findUnique({ where: { slug: TEAM_SLUG } });
    if (!team) throw new Error(`Team "${TEAM_SLUG}" not found.`);

    // Invites are attributed to the team's first founder.
    const founder = await prisma.teamMember.findFirst({
      where: { teamId: team.id, role: 'founder' },
      orderBy: { id: 'asc' },
      select: { accountId: true },
    });
    if (!founder) throw new Error(`Team "${TEAM_SLUG}" has no founder to attribute invites to.`);

    const stores = await prisma.tag.findMany({
      where: { teamId: team.id, parent: 0, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });

    const results: Row[] = [];

    for (const store of stores) {
      const existingOwner = await prisma.brandOwner.findUnique({
        where: { tagId: store.id },
        include: { account: true },
      });

      let username: string;
      let password: string | null = null;
      let status: Row['status'];

      if (existingOwner?.account && existingOwner.account.role === 'brand_owner') {
        username = existingOwner.account.name;
        if (RESET_EXISTING) {
          password = generateBrandOwnerPassword();
          await prisma.accounts.update({
            where: { id: existingOwner.account.id },
            data: { password: await hashPassword(password) },
          });
          status = 'reset';
        } else {
          status = 'existing';
        }
      } else {
        // Fresh owner — generate a clean username + password (same generator the
        // app uses), create the account and bind it to the store.
        const creds = await generateBrandOwnerCredentials(store.name, async (candidate) => {
          const collision = await prisma.accounts.findFirst({ where: { name: candidate }, select: { id: true } });
          return !!collision;
        });
        password = creds.password;
        username = creds.username;
        const account = await prisma.accounts.create({
          data: {
            name: creds.username,
            nickname: `${store.name} Owner`,
            password: await hashPassword(creds.password),
            role: 'brand_owner',
          },
        });
        await prisma.brandOwner.upsert({
          where: { tagId: store.id },
          update: { accountId: account.id, invitedById: founder.accountId },
          create: { accountId: account.id, tagId: store.id, invitedById: founder.accountId },
        });
        status = 'created';
      }

      // Every store gets a fresh 15-min magic link they can tap to sign in.
      const owner = await prisma.brandOwner.findUnique({ where: { tagId: store.id }, select: { id: true } });
      const link = await createMagicLink(owner!.id);

      results.push({
        store: store.name,
        username,
        password,
        magicLink: buildMagicLinkUrl(link.rawToken),
        status,
      });
    }

    // --- Print the handout table ---
    const loginUrl = buildOwnerLoginUrl();
    console.log(`\nBrand-owner logins for team "${TEAM_SLUG}"`);
    console.log(`Sign-in page: ${loginUrl}\n`);
    for (const r of results) {
      console.log(`${r.store}`);
      console.log(`   username : ${r.username}`);
      console.log(`   password : ${r.password ?? '(unchanged — already set; use RESET_EXISTING=true to roll)'}`);
      console.log(`   magiclink: ${r.magicLink}   (one tap, expires in 15 min)`);
      console.log(`   status   : ${r.status}\n`);
    }

    const created = results.filter((r) => r.status === 'created').length;
    const reset = results.filter((r) => r.status === 'reset').length;
    const existing = results.filter((r) => r.status === 'existing').length;
    console.log(`Summary: ${created} created, ${reset} reset, ${existing} already set (${results.length} stores).`);
    console.log('Note: magic links expire in 15 min — re-run to mint fresh ones, or share the username/password.');
    if (!process.env.BOULDHQ_PUBLIC_URL) {
      console.log('Tip: set BOULDHQ_PUBLIC_URL=https://your-host so the printed links point at the right server.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
