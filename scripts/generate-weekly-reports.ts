// Generate this week's client report for every store on a team.
//
// First report = a friendly, non-technical introduction to BouldHQ's weekly
// reports plus a simple 5-step SEO plan for the store. Logos are embedded as
// data URIs so the report renders everywhere (in-app, downloaded, shared) with
// no broken images and no auth required.
//
// Idempotent: deletes any existing report for the same store + week before
// writing the fresh one, so re-running just refreshes.
//
// Run with:   bun --env-file ../.env scripts/generate-weekly-reports.ts
//   (from the repo root, or it will chdir into server/ itself)
//
// Target a different database by setting DATABASE_URL, e.g. production:
//   DATABASE_URL=postgresql://... bun --env-file /dev/null scripts/generate-weekly-reports.ts

import path from 'path';
import { createRequire } from 'module';

// pathConstant captures process.cwd() at import time. The server runs from
// server/, so chdir there before importing anything that reads the upload path.
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

// sharp is a dependency of the server workspace, not of scripts/, so resolve it
// from the server's node_modules rather than relative to this file.
const requireFromServer = createRequire(path.join(SERVER_DIR, 'package.json'));
function getSharp(): any | null {
  try { return requireFromServer('sharp'); } catch { return null; }
}

const TEAM_SLUG = process.env.TEAM_SLUG || 'bouldhq';

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

// Read an image and return a data URI. Raster images are downscaled to a sane
// height first (logos render small) so embedding them doesn't bloat the report.
async function fileToDataUri(absPath: string, maxHeight = 0): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    const ext = path.extname(absPath).toLowerCase();
    let buf = await fs.readFile(absPath);
    const sharp = maxHeight > 0 && ext !== '.svg' ? getSharp() : null;
    if (sharp) {
      try {
        buf = await sharp(buf).resize({ height: maxHeight, withoutEnlargement: true }).png().toBuffer();
        return `data:image/png;base64,${buf.toString('base64')}`;
      } catch (e: any) {
        console.warn(`    [logo resize fell back to raw for ${path.basename(absPath)}: ${e?.message || e}]`);
      }
    }
    return `data:${mimeForExt(ext)};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// The five plain-English SEO improvements we lead with on a first report. These
// apply to any Shopify store and are written for a store owner, not a developer.
const SEO_TASKS: Array<{ title: string; body: string }> = [
  {
    title: 'Sharpen your page titles & descriptions',
    body: 'We rewrite the little title and blurb Google shows for your store so it reads clearly and makes people want to click.',
  },
  {
    title: 'Fill in product details & image text',
    body: 'Every product gets a proper description and image labels — this helps you turn up in Google searches and Google Images.',
  },
  {
    title: 'Speed up your store',
    body: 'Faster pages rank higher and lose fewer shoppers. We find what is slowing things down and trim it.',
  },
  {
    title: 'Use the words your customers search',
    body: 'We match your product wording to what people actually type into Google, so the right buyers find you.',
  },
  {
    title: 'Tidy up your store’s structure & links',
    body: 'A clean, well-linked layout makes it easy for both Google and shoppers to find everything you sell.',
  },
];

function reportHtml(opts: {
  storeName: string;
  storeUrl: string;
  dateLabel: string;
  timestamp: string;
  bouldhqLogo: string | null;
  storeLogo: string | null;
}): string {
  const { storeName, storeUrl, dateLabel, timestamp, bouldhqLogo, storeLogo } = opts;
  const storeUrlDisplay = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const bouldMark = bouldhqLogo
    ? `<img class="bouldhq-mark" src="${bouldhqLogo}" alt="BouldHQ" />`
    : `<span class="store">BouldHQ</span>`;
  const storeMark = storeLogo
    ? `<img class="store-mark" src="${storeLogo}" alt="${storeName}" />`
    : `<span class="store">${storeName}</span>`;
  const metaLink = storeUrl
    ? `<br/><a href="${storeUrl}">${storeUrlDisplay}</a>`
    : '';

  const tasks = SEO_TASKS.map(
    (t, i) => `
      <li>
        <span class="step">${i + 1}</span>
        <span class="step-body"><strong>${t.title}.</strong> ${t.body}</span>
      </li>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${storeName} — Your First BouldHQ Report — ${dateLabel}</title>
<style>
  :root {
    --brand-primary: #A5B4FC;
    --brand-accent:  #A78BFA;
    --brand-success: #34D399;
    --bg:            #0C0C1D;
    --surface:       #13132C;
    --border:        #252554;
    --text:          #E8E8F8;
    --muted:         #8890B4;
    --hairline:      #1C1C3E;
    --radius:        14px;
    --maxw:          820px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
         -webkit-font-smoothing: antialiased; color-scheme: dark; }
  .wrap { max-width: var(--maxw); margin: 0 auto; padding: 56px 28px 80px; }
  header.cobrand { display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 28px; margin-bottom: 36px; border-bottom: 1px solid var(--hairline); }
  .cobrand-marks { display: flex; align-items: center; gap: 16px; font-weight: 700; font-size: 20px; }
  .cobrand-marks .bouldhq-mark { height: 26px; width: auto; display: block; }
  .cobrand-marks .store-mark { height: 34px; width: auto; display: block; border-radius: 6px;
    background: #1e1e3a; border: 1px solid var(--border); padding: 4px 8px; }
  .cobrand-marks .x { color: var(--muted); font-weight: 400; }
  .cobrand-marks .store { color: var(--brand-accent); border: 1px solid var(--border);
    background: var(--surface); padding: 4px 14px; border-radius: 999px; font-size: 16px; }
  header .meta { color: var(--muted); font-size: 12.5px; text-align: right; line-height: 1.55; }
  header .meta a { color: var(--brand-accent); text-decoration: none; }
  .title { margin-bottom: 26px; }
  h1 { font-size: 30px; letter-spacing: -0.025em; margin: 0 0 10px; }
  .pill { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px;
    background: rgba(167, 139, 250, 0.18); color: var(--brand-accent); font-size: 12px; font-weight: 600; }
  section.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 22px 26px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.5); }
  section.card h2 { font-size: 15px; font-weight: 700; margin: 0 0 14px; color: var(--brand-primary);
    text-transform: uppercase; letter-spacing: 0.06em; }
  section.card p { line-height: 1.7; margin: 0 0 10px; }
  ul.plan { list-style: none; padding: 0; margin: 4px 0 0; }
  ul.plan li { display: flex; gap: 14px; align-items: flex-start; margin: 0 0 16px; line-height: 1.6; }
  ul.plan li:last-child { margin-bottom: 0; }
  .step { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 999px; display: inline-flex;
    align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
    background: rgba(167, 139, 250, 0.18); color: var(--brand-accent); }
  .step-body strong { color: var(--text); }
  footer { text-align: center; color: var(--muted); font-size: 11.5px; margin-top: 44px;
    padding-top: 20px; border-top: 1px solid var(--hairline); }
  footer img { height: 14px; width: auto; vertical-align: middle; }
  @media (max-width: 640px) {
    .wrap { padding: 28px 14px 48px; }
    h1 { font-size: 24px; }
    header.cobrand { flex-direction: column; align-items: flex-start; gap: 14px; }
    header .meta { text-align: left; }
    section.card { padding: 18px 16px; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="cobrand">
      <div class="cobrand-marks">
        ${bouldMark}
        <span class="x">×</span>
        ${storeMark}
      </div>
      <div class="meta">Week of ${dateLabel}${metaLink}</div>
    </header>

    <div class="title">
      <h1>Welcome to your first weekly report</h1>
      <span class="pill">Getting started</span>
    </div>

    <section class="card">
      <h2>Hi from the BouldHQ team</h2>
      <p>Thanks for working with us! Each week we’ll send you a short, plain-English
      report on how your store is doing and what we’re working on for you — no jargon,
      just clear updates you can actually use.</p>
      <p>This first report is a quick introduction. We’re kicking things off by focusing
      on <strong>SEO</strong> — the work that helps more of the right customers find
      ${storeName} on Google. As the weeks go on, these reports will get richer with
      real numbers and results.</p>
    </section>

    <section class="card">
      <h2>This week’s focus — 5 ways we’ll improve your SEO</h2>
      <ul class="plan">${tasks}</ul>
    </section>

    <section class="card">
      <h2>What happens next</h2>
      <p>We’ll start on the steps above this week and report back on progress in your
      next update. If you have questions or something you’d like us to prioritise, just
      reply — we’re here to help your store grow.</p>
    </section>

    <footer>
      ${bouldhqLogo ? `<img src="${bouldhqLogo}" alt="BouldHQ" />&nbsp;·&nbsp;` : 'BouldHQ&nbsp;·&nbsp;'}Generated ${timestamp}
    </footer>
  </div>
</body>
</html>`;
}

async function ensureFolderRow(prisma: any, accountId: number, perfixPath: string): Promise<void> {
  if (!perfixPath) return;
  const segments = perfixPath.split(',');
  for (let i = 1; i <= segments.length; i++) {
    const p = segments.slice(0, i).join(',');
    const exists = await prisma.attachments.findFirst({
      where: { accountId, type: 'folder', perfixPath: p, name: '.folder' },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.attachments.create({
      data: {
        path: `/api/file/${segments.slice(0, i).join('/')}/.folder`,
        name: '.folder', size: 0, type: 'folder', perfixPath: p, depth: i,
        accountId, isShare: false, sharePassword: '', sortOrder: 0,
      },
    });
  }
}

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { FileService } = await import('../server/lib/files');
  const { UPLOAD_FILE_PATH } = await import('../shared/lib/pathConstant');
  const prisma = new PrismaClient();

  try {
    const team = await prisma.team.findUnique({ where: { slug: TEAM_SLUG } });
    if (!team) throw new Error(`Team "${TEAM_SLUG}" not found. Run prisma:migrate:deploy first.`);

    // Reports are owned by the team's first founder (same stability rule the
    // bootstrap-docs job uses), so they land in that account's Resources.
    const founder = await prisma.teamMember.findFirst({
      where: { teamId: team.id, role: 'founder' },
      orderBy: { id: 'asc' },
      select: { accountId: true },
    });
    if (!founder) throw new Error(`Team "${TEAM_SLUG}" has no founder to own the reports.`);
    const ownerAccountId = founder.accountId;

    const stores = await prisma.tag.findMany({
      where: { teamId: team.id, parent: 0, archivedAt: null },
      select: { id: true, name: true, storeProfile: { select: { logoPath: true, storeUrl: true } } },
      orderBy: { id: 'asc' },
    });

    // BouldHQ wordmark lives in app/public and ships with the frontend.
    const bouldhqLogo = await fileToDataUri(path.resolve(SERVER_DIR, '..', 'app', 'public', 'bouldhq-logo.png'), 56);

    const today = new Date();
    const dateLabel = today.toISOString().slice(0, 10);
    const timestamp = today.toISOString();

    console.log(`Team "${TEAM_SLUG}" → ${stores.length} store(s). Owner account #${ownerAccountId}.\n`);

    for (const store of stores) {
      const folderPath = `Branding Assets,${store.name},Reports`;
      const slug = store.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const filename = `${slug}-${dateLabel}.html`;

      // 1. Delete prior reports for this store (last week's etc.) so re-running
      //    refreshes rather than piling up.
      const removed = await prisma.attachments.deleteMany({
        where: { accountId: ownerAccountId, perfixPath: folderPath, type: 'text/html' },
      });

      // 2. Build the store logo data URI from its profile, if present on disk.
      let storeLogo: string | null = null;
      const logoPath = store.storeProfile?.logoPath || '';
      if (logoPath) {
        const base = logoPath.replace(/^\/api\/file\//, '');
        storeLogo = await fileToDataUri(path.join(UPLOAD_FILE_PATH, base), 72);
      }

      const html = reportHtml({
        storeName: store.name,
        storeUrl: store.storeProfile?.storeUrl || '',
        dateLabel, timestamp, bouldhqLogo, storeLogo,
      });

      // 3. Save + file into Branding Assets › <store> › Reports.
      await ensureFolderRow(prisma, ownerAccountId, folderPath);
      const { filePath } = await FileService.uploadFile({
        buffer: Buffer.from(html, 'utf-8'),
        originalName: filename,
        type: 'text/html',
        accountId: ownerAccountId,
        metadata: { bouldhqReport: dateLabel, kind: 'weekly-report' },
      });
      // File it into the folder and give it a clean, human display name (the
      // upload helper otherwise derives an ugly truncated name like "22.html").
      await prisma.attachments.updateMany({
        where: { path: filePath, accountId: ownerAccountId },
        data: { perfixPath: folderPath, depth: folderPath.split(',').length + 1, name: filename },
      });

      console.log(
        `  ✓ ${store.name.padEnd(20)} report → ${folderPath} › ${filename}` +
        `  ${storeLogo ? '(logo embedded)' : '(no logo — name pill)'}` +
        `${removed.count ? `  [replaced ${removed.count} old]` : ''}`,
      );
    }

    console.log('\nDone. Reports are visible under Resources › Branding Assets › <store> › Reports,');
    console.log('and to each store owner via the brand-owner portal.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
