// Migrates the screenshots from ~/Desktop/Resoursesbouldhqscreenshots/ into
// the BouldHQ Resources panel, organized into per-workflow subfolders, and
// generates a self-contained HTML walkthrough that embeds them inline as
// base64 (works inside the in-app HtmlPreviewModal — no auth/blob URL issues).
//
// Idempotent: re-running replaces existing copies (matched by accountId +
// perfixPath + name).

import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';

// pathConstant captures process.cwd() at import time — server runs from server/,
// so we chdir before any dynamic import.
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

const SRC_ROOT = path.join(os.homedir(), 'Desktop', 'Resoursesbouldhqscreenshots');
const DOC_FOLDER = 'BouldHQ Setup Guides';
const SOPS_ROOT = 'SOPs';
const DOC_NAME = 'Onboarding_Workflow_Screenshots.html';

type Workflow = {
  title: string;          // visible heading in the doc
  blurb: string;          // 1-2 sentence intro
  sourceSubdir: string;   // relative path under SRC_ROOT
  folderName: string;     // resources subfolder name (creates SOPs,<folderName>)
};

const WORKFLOWS: Workflow[] = [
  {
    title: 'Shopify collaborator access',
    blurb: 'How a salesman walks a store owner through approving us as a collaborator on their Shopify store. Captured live during one onboarding; the manager can re-shoot when Shopify Admin UI changes.',
    sourceSubdir: 'onboardingCollabAccess ',  // trailing space preserved — that's literally the folder name
    folderName: 'Collaborator Access',
  },
  {
    title: 'Migrating a domain into a store',
    blurb: 'Single capture showing the DNS / domain settings page used during a store migration.',
    sourceSubdir: 'Onboarding Migrating Domain',
    folderName: 'Migrating Domain',
  },
];

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { FileService } = await import('../server/lib/files');

  const p = new PrismaClient();
  try {
    const founder = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
    if (!founder) throw new Error('No account found');

    // Verify source exists.
    const srcExists = !!(await fs.stat(SRC_ROOT).catch(() => null));
    if (!srcExists) throw new Error(`Source folder missing: ${SRC_ROOT}`);

    // ---- 1. Upload each screenshot, file it into the per-workflow subfolder.
    type Uploaded = { workflow: Workflow; file: string; resourcePath: string; base64: string; mime: string };
    const uploaded: Uploaded[] = [];

    for (const wf of WORKFLOWS) {
      const dir = path.join(SRC_ROOT, wf.sourceSubdir);
      const entries = await fs.readdir(dir).catch(() => []);
      const pngFiles = entries
        .filter((n) => /\.(png|jpe?g|gif|webp)$/i.test(n))
        .sort();  // chronological because of timestamp in name

      for (const file of pngFiles) {
        const abs = path.join(dir, file);
        const buf = await fs.readFile(abs);

        // Idempotent replace: drop existing copy in target folder first.
        const targetPerfix = `${SOPS_ROOT},${wf.folderName}`;
        const existing = await p.attachments.findFirst({
          where: { accountId: founder.id, perfixPath: targetPerfix, name: file },
        });
        if (existing) {
          await FileService.deleteFile(existing.path).catch(() => undefined);
        }

        const mime = file.toLowerCase().endsWith('.png') ? 'image/png'
          : file.toLowerCase().match(/\.jpe?g$/) ? 'image/jpeg'
          : file.toLowerCase().endsWith('.gif') ? 'image/gif'
          : file.toLowerCase().endsWith('.webp') ? 'image/webp'
          : 'application/octet-stream';

        const upl = await FileService.uploadFile({
          buffer: buf, originalName: file, type: mime, accountId: founder.id,
        });

        const created = await p.attachments.findFirst({
          where: { accountId: founder.id, path: upl.filePath },
        });
        if (!created) throw new Error(`attachment row missing after upload: ${file}`);
        await p.attachments.update({
          where: { id: created.id },
          data: { perfixPath: targetPerfix, depth: 2, type: mime },
        });

        uploaded.push({
          workflow: wf, file,
          resourcePath: upl.filePath,
          base64: buf.toString('base64'),
          mime,
        });
      }
    }

    console.log(`✓ Uploaded ${uploaded.length} screenshot(s) into Resources/${SOPS_ROOT}/...`);

    // ---- 2. Build a self-contained HTML doc with images inlined as base64.
    const sections = WORKFLOWS.map((wf) => {
      const shots = uploaded.filter((u) => u.workflow.folderName === wf.folderName);
      const cards = shots.map((s, i) => `
        <figure class="card">
          <div class="step-badge">Step ${i + 1}</div>
          <img src="data:${s.mime};base64,${s.base64}" alt="${escHtml(wf.title)} — step ${i + 1}" loading="lazy" />
          <figcaption>
            <div class="file">${escHtml(s.file)}</div>
            <div class="caption" contenteditable="false">Caption — edit me in the seed script and re-run.</div>
          </figcaption>
        </figure>
      `).join('\n');
      return `
<section id="${escHtml(wf.folderName.toLowerCase().replace(/\s+/g, '-'))}">
  <header>
    <div class="eyebrow">${shots.length} step${shots.length === 1 ? '' : 's'} · stored under <code>Resources / ${SOPS_ROOT} / ${escHtml(wf.folderName)}</code></div>
    <h2>${escHtml(wf.title)}</h2>
    <p class="lead">${escHtml(wf.blurb)}</p>
  </header>
  <div class="grid">${cards}</div>
</section>
      `;
    }).join('\n');

    const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding workflow screenshots — BouldHQ</title>
<style>
  :root {
    --bg: #0d1117; --bg-soft: #161b22; --border: #30363d; --border-soft: #21262d;
    --text: #e6edf3; --text-muted: #8b949e; --accent: #58a6ff;
    --mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#fff; --bg-soft:#f6f8fa; --border:#d0d7de; --border-soft:#e1e4e8;
            --text:#1f2328; --text-muted:#57606a; --accent:#0969da; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body { font: 14.5px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 32px 24px 80px; }
  header.hero { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
  header.hero .eyebrow { font: 600 11px/1.4 system-ui; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-bottom: 6px; }
  header.hero h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: -.01em; }
  header.hero p.lead { margin: 0; color: var(--text-muted); max-width: 65ch; }
  section { margin: 48px 0; }
  section header .eyebrow { font: 600 11px/1.4 system-ui; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-bottom: 6px; }
  section header h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: -.005em; }
  section header p.lead { margin: 0 0 16px; color: var(--text-muted); max-width: 65ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }
  .card { margin: 0; background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 8px; overflow: hidden; position: relative; }
  .card img { display: block; width: 100%; height: auto; }
  .step-badge { position: absolute; top: 8px; left: 8px; background: var(--accent); color: white; font: 700 11px/1 system-ui; padding: 4px 8px; border-radius: 999px; }
  figcaption { padding: 10px 12px; border-top: 1px solid var(--border-soft); }
  figcaption .file { font: 11px var(--mono); color: var(--text-muted); margin-bottom: 4px; word-break: break-all; }
  figcaption .caption { font-size: 13px; color: var(--text); }
  code { font: 12.5px var(--mono); background: var(--bg-soft); border: 1px solid var(--border-soft); padding: 1px 5px; border-radius: 4px; }
  footer.note { margin-top: 56px; padding: 14px 18px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); font-size: 13px; }
  footer.note strong { color: var(--text); }
</style>
</head><body>
<div class="wrap">

<header class="hero">
  <div class="eyebrow">Onboarding · workflow screenshots</div>
  <h1>BouldHQ onboarding screenshots</h1>
  <p class="lead">Visual walk-throughs for the two onboarding rituals the team performs on every new store: granting BouldHQ Shopify collaborator access, and migrating a domain into the store. The raw screenshots are also stored under <code>Resources / ${SOPS_ROOT} /</code> so any teammate can browse them directly.</p>
</header>

${sections}

<footer class="note">
  <strong>Editing this doc:</strong> the source is <code>scripts/seed-onboarding-screenshots.ts</code>. Update captions or workflow descriptions there and re-run <code>bun --env-file .env scripts/seed-onboarding-screenshots.ts</code>. The seed is idempotent — existing files are replaced.
</footer>

</div></body></html>`;

    // ---- 3. Save the HTML doc under BouldHQ Setup Guides.
    const existingDoc = await p.attachments.findFirst({
      where: { accountId: founder.id, perfixPath: DOC_FOLDER, name: DOC_NAME },
    });
    if (existingDoc) {
      await FileService.deleteFile(existingDoc.path).catch(() => undefined);
    }

    const docUpl = await FileService.uploadFile({
      buffer: Buffer.from(html, 'utf8'),
      originalName: DOC_NAME,
      type: 'text/html',
      accountId: founder.id,
    });
    const docRow = await p.attachments.findFirst({
      where: { accountId: founder.id, path: docUpl.filePath },
    });
    if (!docRow) throw new Error('doc attachment row missing');
    await p.attachments.update({
      where: { id: docRow.id },
      data: { perfixPath: DOC_FOLDER, depth: 1, type: 'text/html' },
    });

    console.log(`✓ Wrote ${DOC_NAME} → Resources / ${DOC_FOLDER}/`);
    console.log(`  → ${Math.round(html.length / 1024)} KB self-contained (images inlined)`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
