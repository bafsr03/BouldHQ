// File an HTML report into a store's Resources → Branding Assets › <store> › Reports
// folder, the same way the app's /report flow and generate-weekly-reports.ts do.
//
// This is the sanctioned bridge for report-producing agents (e.g. the shopify-seo
// Claude Code agent) that generate an HTML deliverable on disk and need it to show
// up in the app's Resources panel. Bytes are copied into Blinko's file store and an
// attachments row is created + filed under the Reports folder, owned by the team's
// first founder (same stability rule the weekly-report job uses).
//
// Idempotent per display name: re-filing a report with the same --name replaces the
// previous copy in that folder rather than piling up duplicates. It only removes the
// file whose name matches, so sibling reports (e.g. the weekly report) are untouched.
//
// Run with:   bun --env-file .env scripts/file-report.ts \
//               --store "Rubio-Brothers-Concrete" \
//               --file  /path/to/report.html \
//               [--name rubio-brothers-concrete-seo-audit-2026-07-06.html] \
//               [--team bouldhq]
//
// Target a different database by setting DATABASE_URL.

import path from 'path';

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.html':
    case '.htm': return 'text/html';
    case '.md': return 'text/markdown';
    case '.txt': return 'text/plain';
    case '.json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

async function main() {
  const storeArg = arg('--store');
  const fileArg = arg('--file');
  const teamSlug = arg('--team') || process.env.TEAM_SLUG || 'bouldhq';
  if (!storeArg || !fileArg) {
    console.error('Usage: bun scripts/file-report.ts --store "<store name>" --file <path.html> [--name <display>] [--team <slug>]');
    process.exit(2);
  }

  const fs = await import('fs/promises');
  const absFile = path.resolve(process.env.INIT_CWD || process.cwd(), fileArg);
  const buffer = await fs.readFile(absFile);
  const ext = path.extname(absFile) || '.html';
  const displayName = arg('--name') || path.basename(absFile);
  const mimeType = mimeForExt(ext);

  const { PrismaClient } = await import('@prisma/client');
  const { FileService } = await import('../server/lib/files');
  const prisma = new PrismaClient();

  try {
    const team = await prisma.team.findUnique({ where: { slug: teamSlug } });
    if (!team) throw new Error(`Team "${teamSlug}" not found.`);

    const founder = await prisma.teamMember.findFirst({
      where: { teamId: team.id, role: 'founder' },
      orderBy: { id: 'asc' },
      select: { accountId: true },
    });
    if (!founder) throw new Error(`Team "${teamSlug}" has no founder to own the report.`);
    const ownerAccountId = founder.accountId;

    // Resolve the store tag (case-insensitive), then use its canonical name so the
    // folder path matches exactly what the UI already shows.
    const stores = await prisma.tag.findMany({
      where: { teamId: team.id, parent: 0, archivedAt: null },
      select: { id: true, name: true },
    });
    const store = stores.find(
      (s) => (s.name || '').toLowerCase() === storeArg.toLowerCase(),
    ) || stores.find((s) => (s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      === storeArg.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    if (!store?.name) {
      throw new Error(`Store "${storeArg}" not found on team "${teamSlug}". Known: ${stores.map((s) => s.name).join(', ')}`);
    }

    const folderPath = `Branding Assets,${store.name},Reports`;

    // Ensure every segment of the folder path exists as a folder row so it renders.
    const segments = folderPath.split(',');
    for (let i = 1; i <= segments.length; i++) {
      const p = segments.slice(0, i).join(',');
      const exists = await prisma.attachments.findFirst({
        where: { accountId: ownerAccountId, type: 'folder', perfixPath: p, name: '.folder' },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.attachments.create({
        data: {
          path: `/api/file/${segments.slice(0, i).join('/')}/.folder`,
          name: '.folder', size: 0, type: 'folder', perfixPath: p, depth: i,
          accountId: ownerAccountId, isShare: false, sharePassword: '', sortOrder: 0,
        },
      });
    }

    // Idempotent: drop any prior copy of THIS report (same display name) in the folder.
    const priors = await prisma.attachments.findMany({
      where: { accountId: ownerAccountId, perfixPath: folderPath, name: displayName },
      select: { id: true, path: true },
    });
    for (const p of priors) {
      try { await FileService.deleteFile(p.path); }
      catch { try { await prisma.attachments.delete({ where: { id: p.id } }); } catch { /* gone */ } }
    }

    // Copy bytes into Blinko's file store, then file the row into the Reports folder
    // and give it the clean display name.
    const { filePath } = await FileService.uploadFile({
      buffer,
      originalName: displayName,
      type: mimeType,
      accountId: ownerAccountId,
      metadata: { kind: 'report', filedBy: 'file-report-script', filedAt: new Date().toISOString() },
    });
    await prisma.attachments.updateMany({
      where: { path: filePath, accountId: ownerAccountId },
      data: { perfixPath: folderPath, depth: segments.length + 1, name: displayName },
    });

    console.log(
      `✓ Filed "${displayName}" (${(buffer.length / 1024).toFixed(1)} kB) → ` +
      `Resources › ${folderPath.replace(/,/g, ' › ')}` +
      `${priors.length ? `  [replaced ${priors.length}]` : ''}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
