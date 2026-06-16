// One-shot bulk-import: scans ~/Desktop/ for folders whose name matches a
// team store (case-insensitive, ignoring punctuation differences), rsyncs each
// into ~/.bouldhq-workdirs/<slug>/.
//
// Idempotent — rsync -a without --delete means re-running is safe.

import path from 'path';

// pathConstant captures process.cwd() at import time. Server runs from server/,
// so this script chdirs before any other import.
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

async function main() {
  const fs = await import('fs/promises');
  const os = await import('os');
  const { PrismaClient } = await import('@prisma/client');
  const { importFolderIntoWorkdir, workdirFor } = await import('../server/lib/opsConsole');

  const HOME = os.homedir();
  const DESKTOP = path.join(HOME, 'Desktop');

  const p = new PrismaClient();
  try {
    // Pull every active store across every team.
    const stores = await p.tag.findMany({
      where: { parent: 0, teamId: { not: null }, archivedAt: null },
      select: { id: true, name: true },
    });

    // Index Desktop folders by a normalized key (lowercase, alphanumeric only).
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const desktopEntries = await fs.readdir(DESKTOP, { withFileTypes: true }).catch(() => []);
    const desktopFolders = desktopEntries.filter((e) => e.isDirectory()).map((e) => ({
      name: e.name,
      abs: path.join(DESKTOP, e.name),
      key: norm(e.name),
    }));

    const results: Array<{
      store: string;
      desktopMatch: string | null;
      destination: string;
      status: 'imported' | 'already_present' | 'no_desktop_match' | 'failed';
      error?: string;
    }> = [];

    for (const store of stores) {
      const key = norm(store.name);
      // Look for an exact normalized match first, then a startsWith match.
      const match =
        desktopFolders.find((d) => d.key === key)
        ?? desktopFolders.find((d) => d.key.startsWith(key))
        ?? desktopFolders.find((d) => d.key.includes(key));

      const destination = workdirFor(store.name);
      const destExists = !!(await fs.stat(destination).catch(() => null));

      if (!match) {
        results.push({
          store: store.name, desktopMatch: null, destination,
          status: destExists ? 'already_present' : 'no_desktop_match',
        });
        continue;
      }

      try {
        await importFolderIntoWorkdir(match.abs, store.name);
        results.push({
          store: store.name, desktopMatch: match.name, destination,
          status: 'imported',
        });
      } catch (e: any) {
        results.push({
          store: store.name, desktopMatch: match.name, destination,
          status: 'failed', error: e?.message ?? String(e),
        });
      }
    }

    console.log(JSON.stringify(results, null, 2));
    const imported = results.filter((r) => r.status === 'imported').length;
    const failed   = results.filter((r) => r.status === 'failed').length;
    const skipped  = results.filter((r) => r.status === 'no_desktop_match').length;
    console.log(`\n✓ Imported: ${imported}  ·  Already present: ${results.length - imported - failed - skipped}  ·  No match on Desktop: ${skipped}  ·  Failed: ${failed}`);
    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
