// Seeds three role-specific onboarding HTML guides into Resources →
// BouldHQ Setup Guides for the founder account. Each is self-contained,
// follows the same visual language as the main Walkthrough, and is written
// for someone reading it on day one (not a technical reference).

// pathConstant captures process.cwd() at import time — server runs from server/,
// so we must chdir before importing FileService/bouldhq.
import path from 'path';
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

const TARGET_FOLDER = 'BouldHQ Setup Guides';

// --- Shared style block. Same palette + density as the main walkthrough, but
// the body layout per page is calmer (more whitespace, fewer tables, friendly
// numbered cards instead of dense reference dl's).
const STYLE = String.raw`
<style>
  :root {
    --bg: #0d1117; --bg-soft: #161b22; --bg-elev: #1c2128;
    --border: #30363d; --border-soft: #21262d;
    --text: #e6edf3; --text-muted: #8b949e; --text-dim: #6e7681;
    --accent: #58a6ff; --warn: #d29922; --good: #3fb950; --bad: #f85149;
    --founder: #d29922; --manager: #58a6ff; --salesman: #8b949e;
    --mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff; --bg-soft: #f6f8fa; --bg-elev: #ffffff;
      --border: #d0d7de; --border-soft: #e1e4e8;
      --text: #1f2328; --text-muted: #57606a; --text-dim: #6e7781;
      --accent: #0969da; --warn: #9a6700; --good: #1a7f37; --bad: #cf222e;
      --founder: #9a6700; --manager: #0969da; --salesman: #57606a;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
  body {
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
  @media (max-width: 600px) { .wrap { padding: 32px 18px 64px; } }

  header.hero { margin-bottom: 40px; padding-bottom: 28px; border-bottom: 1px solid var(--border); }
  header.hero .eyebrow { font: 600 11px/1.4 system-ui; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  header.hero h1 { margin: 0 0 12px; font-size: 36px; line-height: 1.1; letter-spacing: -.015em; }
  header.hero p.lead { margin: 0; color: var(--text-muted); font-size: 17px; max-width: 60ch; }

  h2.section { margin: 48px 0 16px; font-size: 22px; letter-spacing: -.005em; display: flex; align-items: center; gap: 10px; }
  h2.section .num { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px; background: var(--bg-soft); border: 1px solid var(--border); color: var(--text); font: 700 13px/1 system-ui; }
  p { margin: 0 0 14px; }
  .lead-section { font-size: 16px; color: var(--text-muted); margin-bottom: 18px; }

  /* Step cards */
  ol.steps { list-style: none; padding: 0; margin: 0; counter-reset: step; }
  ol.steps > li {
    counter-increment: step;
    background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 10px;
    padding: 18px 20px 18px 64px;
    margin: 0 0 12px;
    position: relative;
  }
  ol.steps > li::before {
    content: counter(step);
    position: absolute; top: 18px; left: 18px;
    width: 32px; height: 32px; border-radius: 999px;
    background: var(--accent); color: white;
    display: inline-flex; align-items: center; justify-content: center;
    font: 700 14px/1 system-ui;
  }
  ol.steps h3 { margin: 0 0 6px; font-size: 16px; }
  ol.steps p { margin: 0; color: var(--text-muted); font-size: 14.5px; line-height: 1.55; }
  ol.steps p + p { margin-top: 8px; }

  /* Inline atoms */
  code, kbd {
    font: 13.5px var(--mono); background: var(--bg-soft);
    border: 1px solid var(--border-soft); padding: 1px 6px; border-radius: 4px;
  }
  .path { font: 13.5px var(--mono); color: var(--accent); }
  .role { display: inline-block; padding: 2px 8px; border-radius: 999px; font: 700 11px/1.6 system-ui; vertical-align: 2px; }
  .role.founder  { background: rgba(210,153,34,.16); color: var(--founder);  border: 1px solid rgba(210,153,34,.35); }
  .role.manager  { background: rgba(88,166,255,.14); color: var(--manager);  border: 1px solid rgba(88,166,255,.32); }
  .role.salesman { background: rgba(139,148,158,.16); color: var(--salesman); border: 1px solid rgba(139,148,158,.30); }

  /* Tile rows */
  .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 8px 0 12px; }
  @media (max-width: 600px) { .tiles { grid-template-columns: 1fr; } }
  .tile {
    background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 10px;
    padding: 14px 16px;
  }
  .tile .label { font: 600 11px/1.4 system-ui; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); margin-bottom: 4px; }
  .tile p { margin: 0; font-size: 14.5px; }

  /* Callouts */
  .callout {
    border-left: 3px solid var(--accent);
    background: var(--bg-soft); padding: 12px 16px;
    border-radius: 4px; font-size: 14.5px;
    margin: 16px 0;
    color: var(--text);
  }
  .callout strong { color: var(--text); }
  .callout.warn { border-left-color: var(--warn); }
  .callout.note { border-left-color: var(--text-muted); }

  /* Checklist */
  ul.checklist { list-style: none; padding: 0; margin: 8px 0 0; }
  ul.checklist li { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border-soft); font-size: 15px; }
  ul.checklist li::before {
    content: ""; width: 18px; height: 18px; flex-shrink: 0;
    border: 1.5px solid var(--border); border-radius: 4px;
    margin-top: 2px;
  }
  ul.checklist li:last-child { border-bottom: none; }

  /* Footer */
  footer.next {
    margin-top: 56px; padding: 18px 20px;
    border: 1px dashed var(--border); border-radius: 10px;
    background: transparent; color: var(--text-muted); font-size: 14.5px;
  }
  footer.next strong { color: var(--text); }
  footer.next a { color: var(--accent); text-decoration: none; }
  footer.next a:hover { text-decoration: underline; }
</style>
`;

// --- FOUNDER ---------------------------------------------------------------
const FOUNDER_HTML = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome, founder — BouldHQ</title>
${STYLE}
</head><body>
<div class="wrap">

<header class="hero">
  <div class="eyebrow"><span class="role founder">founder</span> Onboarding · day one</div>
  <h1>Welcome to BouldHQ.</h1>
  <p class="lead">You're the founder. You see every team, every store, every announcement. This page walks you through the few things to do on day one so the rest of the team can start operating around you.</p>
</header>

<h2 class="section"><span class="num">1</span>What BouldHQ is doing for you</h2>
<p class="lead-section">BouldHQ keeps every store you manage on one page, every team request in one inbox, and every team announcement in one feed. You don't have to chase Slack threads or DMs — the work lives in the app.</p>
<div class="tiles">
  <div class="tile">
    <div class="label">Your control surface</div>
    <p>The <span class="path">/hq</span> dashboard, an overview of every store the team manages.</p>
  </div>
  <div class="tile">
    <div class="label">Your reach</div>
    <p>You can post announcements globally (visible to every team) or just to your active team.</p>
  </div>
  <div class="tile">
    <div class="label">Your safety net</div>
    <p>You're the only one who can permanently delete a store. Managers can archive — only you can erase.</p>
  </div>
  <div class="tile">
    <div class="label">Your sidekick</div>
    <p>The <span class="path">/ai</span> assistant can find anything, save tasks for the manager, and answer "where did I put…" questions.</p>
  </div>
</div>

<h2 class="section"><span class="num">2</span>Three things to do today</h2>
<ol class="steps">
  <li>
    <h3>Open <span class="path">/hq</span> and look around</h3>
    <p>You'll see the team's snapshot (stores managed, new this month, open requests), the roster, and the announcements feed. The "Heads up" section at the top is where automatic updates land — like the weekly store count.</p>
  </li>
  <li>
    <h3>Post a welcome announcement</h3>
    <p>On <span class="path">/hq</span>, scroll to Announcements → click <strong>Post</strong>. Choose <strong>Global</strong> scope so every team sees it. Pin it for the first week. Something like "Welcome — we're using BouldHQ to run our store ops. Onboarding guides are in Resources."</p>
  </li>
  <li>
    <h3>Invite your team</h3>
    <p>Use Prisma Studio for now (or the team router's invite mutation) to add managers and salesmen. Each gets one role per team. You can have multiple teams — useful when you scale past ~20 stores per manager.</p>
  </li>
</ol>

<h2 class="section"><span class="num">3</span>What you'll do most days</h2>
<div class="tiles">
  <div class="tile">
    <div class="label">Skim /hq</div>
    <p>Heads-up + open-requests tile tells you if anything's on fire.</p>
  </div>
  <div class="tile">
    <div class="label">Post updates</div>
    <p>Workflow changes, product announcements, kudos — Workflow updates &amp; Changelog categories.</p>
  </div>
  <div class="tile">
    <div class="label">Spot-check stores</div>
    <p>Open a few <span class="path">/stores/:id</span> pages to see what the team's been doing.</p>
  </div>
  <div class="tile">
    <div class="label">Personal notes on /</div>
    <p>Your own thoughts, half-baked ideas, todos — strictly private to you.</p>
  </div>
</div>

<h2 class="section"><span class="num">4</span>One important rule</h2>
<div class="callout warn">
<strong>Delete is permanent.</strong> Managers can archive a store (reversible). Only you can permanently delete one — and it'll ask you to type the store name to confirm. Notes survive the delete; the store, its profile, and its requests do not. When in doubt, archive.
</div>

<h2 class="section"><span class="num">5</span>You're ready when…</h2>
<ul class="checklist">
  <li>You can name what lives on <span class="path">/hq</span> vs <span class="path">/stores</span> vs <span class="path">/</span> (HQ = team-wide, Stores = per-store ops, slash = personal).</li>
  <li>You've posted a welcome announcement.</li>
  <li>You've at least one manager and one salesman invited to your team.</li>
  <li>You know that archiving is reversible and deleting isn't.</li>
  <li>You've opened the main <strong>BouldHQ Walkthrough</strong> (in this same folder) and know where to look it up.</li>
</ul>

<footer class="next">
  <strong>Next:</strong> Have your manager open <a href="#">BouldHQ_Onboarding_Manager.html</a> and your salesmen open <a href="#">BouldHQ_Onboarding_Salesman.html</a>. Both live in this same <em>BouldHQ Setup Guides</em> folder.
</footer>

</div></body></html>`;

// --- MANAGER ---------------------------------------------------------------
const MANAGER_HTML = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome, manager — BouldHQ</title>
${STYLE}
</head><body>
<div class="wrap">

<header class="hero">
  <div class="eyebrow"><span class="role manager">manager</span> Onboarding · day one</div>
  <h1>Welcome — you're the agent operator.</h1>
  <p class="lead">You handle the queue. When a salesman pastes a store-owner message into BouldHQ, the AI triages it, and what's left for a human comes to you. This is your day-one walkthrough.</p>
</header>

<h2 class="section"><span class="num">1</span>What your day looks like</h2>
<p class="lead-section">Most mornings: open <span class="path">/hq</span>, look at "open requests," handle them. Sometimes you'll jump into the ops console to actually run a fix. That's the loop.</p>
<div class="tiles">
  <div class="tile">
    <div class="label">Your starting point</div>
    <p><span class="path">/hq</span> — snapshot tile shows total open requests across all your stores.</p>
  </div>
  <div class="tile">
    <div class="label">Your queue</div>
    <p>The Requests panel on each <span class="path">/stores/:id</span> page — filter by "needs assistance."</p>
  </div>
  <div class="tile">
    <div class="label">Your workshop</div>
    <p>The Ops Console on each store page — an in-browser terminal scoped to that store.</p>
  </div>
  <div class="tile">
    <div class="label">Your safety net</div>
    <p>"Re-run triage" if the AI got it wrong. "Re-run playbook" if the automated fix needs another shot.</p>
  </div>
</div>

<h2 class="section"><span class="num">2</span>Three things to do today</h2>
<ol class="steps">
  <li>
    <h3>Open <span class="path">/hq</span> and click the open-requests tile</h3>
    <p>That takes you to <span class="path">/stores?filter=open</span> — every store with at least one open request, sorted by urgency. Click any store with a flame chip.</p>
  </li>
  <li>
    <h3>Handle one request end-to-end</h3>
    <p>On the store's page, scroll to the Requests panel. Expand a row marked <strong>needs assistance</strong>. Read the raw body + the AI's suggested action. Click <strong>Take on</strong>. Now it's yours.</p>
    <p>Do the work (often this means opening the Ops Console below). When done, click <strong>Mark done</strong>. The salesman who opened the request now sees it close.</p>
  </li>
  <li>
    <h3>Try the Ops Console</h3>
    <p>Scroll to the Ops Console section, click <strong>Connect</strong>. You're in a shell scoped to <code>.bouldhq-workdirs/team-N/store-M/</code>. Type <code>claude</code> to start a Claude Code session there.</p>
  </li>
</ol>

<h2 class="section"><span class="num">3</span>Reading a request</h2>
<p class="lead-section">When you expand a request, you'll see:</p>
<div class="tiles">
  <div class="tile">
    <div class="label">Raw body</div>
    <p>The salesman's verbatim paste — owner's email, chat, or OCR. Read this first.</p>
  </div>
  <div class="tile">
    <div class="label">AI triage</div>
    <p>The model's decision: automatable or human. Category. Reasoning. Suggested action.</p>
  </div>
  <div class="tile">
    <div class="label">Playbook run</div>
    <p>If the request was automatable, the playbook's log: each step with an ok / warn / fail label.</p>
  </div>
  <div class="tile">
    <div class="label">Your actions</div>
    <p>Take on · Flag (back to needs-assistance) · Mark done · Re-run triage · Re-run playbook.</p>
  </div>
</div>

<h2 class="section"><span class="num">4</span>What to avoid in the Ops Console</h2>
<div class="callout warn">
The shell runs with your local user permissions inside a working directory scoped to the store. <strong>Don't run destructive commands without thinking</strong> — there's no sandbox between you and the host. If you're not sure what a command does, ask Claude in the console first.
</div>
<div class="callout note">
Full-TTY apps (vim, less, htop) won't render correctly — that's a known limitation. Use <code>claude</code>, <code>bash</code>, <code>git</code>, <code>npm</code>, <code>shopify</code>. For heavy editing, SSH from your IDE.
</div>

<h2 class="section"><span class="num">5</span>One important rule</h2>
<div class="callout warn">
<strong>Mark done only when it's really done.</strong> Salesmen and store owners watch the status to know when to follow up. A request stuck in "in progress" makes everyone anxious. If you need to wait for the owner, use <strong>Flag</strong> with a note — that puts it back in needs-assistance with context for the next time you look.
</div>

<h2 class="section"><span class="num">6</span>You're ready when…</h2>
<ul class="checklist">
  <li>You've handled at least one needs-assistance request end-to-end.</li>
  <li>You've connected to the Ops Console on one store and typed <code>pwd</code> to see your working directory.</li>
  <li>You know the four buttons in the request detail (Take on / Flag / Mark done / Re-run triage).</li>
  <li>You know to read the raw body before the AI's suggestion — the salesman pastes it verbatim for a reason.</li>
  <li>You've skimmed the main <strong>BouldHQ Walkthrough</strong> (in this folder) for when you need the reference.</li>
</ul>

<footer class="next">
  <strong>Stuck?</strong> Open <span class="path">/ai</span> — the assistant can find a resource, search your notes, or open a task back to yourself. If you're managing more than ~20 stores, ask the founder to split you across teams.
</footer>

</div></body></html>`;

// --- SALESMAN --------------------------------------------------------------
const SALESMAN_HTML = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome — BouldHQ for salesmen</title>
${STYLE}
</head><body>
<div class="wrap">

<header class="hero">
  <div class="eyebrow"><span class="role salesman">salesman</span> Onboarding · day one</div>
  <h1>Welcome aboard.</h1>
  <p class="lead">Your job is at the front of the funnel: bring new store owners in, capture what they're asking for, hand it off cleanly. The manager and the AI take it from there. This page is your day-one walkthrough.</p>
</header>

<h2 class="section"><span class="num">1</span>What your day looks like</h2>
<p class="lead-section">Two things, mostly: onboarding new stores via the wizard, and dropping owner messages into the right store's Requests panel so they get triaged.</p>
<div class="tiles">
  <div class="tile">
    <div class="label">Your starting point</div>
    <p><span class="path">/stores</span> — the list of every store the team manages.</p>
  </div>
  <div class="tile">
    <div class="label">Your superpower</div>
    <p>You don't have to summarize. Paste the owner's email or chat <em>verbatim</em> into the Requests composer. AI triages on the original wording.</p>
  </div>
  <div class="tile">
    <div class="label">Your personal space</div>
    <p><span class="path">/</span> — your private notes and todos. Nobody else sees them.</p>
  </div>
  <div class="tile">
    <div class="label">Your assistant</div>
    <p><span class="path">/ai</span> — ask "where did I save the brand colors for Joon?" and it finds it. Or "open a task: …" and it logs one for the manager.</p>
  </div>
</div>

<h2 class="section"><span class="num">2</span>Two things to do today</h2>
<ol class="steps">
  <li>
    <h3>Walk through the wizard with a real store</h3>
    <p>Click <strong>New store</strong> on <span class="path">/stores</span>. Four steps:</p>
    <p><strong>1) Identity</strong> — name + optional logo. <strong>2) Shopify access</strong> — store URL, plan, collaborator code (or the toggle if you already have direct access). <strong>3) Requirements</strong> — paste the owner's first message verbatim. <strong>4) Review</strong> → Submit.</p>
    <p>You'll land on the new store's page. A Welcome note and an Onboarding checklist are already waiting.</p>
  </li>
  <li>
    <h3>Open your first request</h3>
    <p>On any store page, click <strong>New request</strong>. Pick the source (text / email / screenshot / voice — what the owner sent you). Paste the message <strong>verbatim</strong>. Don't paraphrase. Submit.</p>
    <p>Watch the status flip from <em>triaging…</em> to either <em>auto running</em> (the AI will handle it) or <em>needs assistance</em> (your manager will).</p>
  </li>
</ol>

<h2 class="section"><span class="num">3</span>The one rule about pasting messages</h2>
<div class="callout">
<strong>Don't summarize.</strong> The AI's job is to triage on the original wording — owner's tone, exact ask, specific URLs and codes they mentioned. If you summarize, you strip out signal. Paste, then add a one-line note at the bottom if there's something the owner didn't say but you know.
</div>

<h2 class="section"><span class="num">4</span>Filing things in the right place</h2>
<div class="tiles">
  <div class="tile">
    <div class="label">Owner sent a logo / brand asset</div>
    <p>Upload it to <span class="path">/resources</span>. If the filename has the store name (e.g. <code>joon-logo.png</code>), it auto-files under <em>Branding Assets/Joon/</em>. If not, right-click → <strong>File under store…</strong>.</p>
  </div>
  <div class="tile">
    <div class="label">An idea you don't want to forget</div>
    <p>Personal note on <span class="path">/</span>. Yours alone. Use <code>#hashtags</code> to organize. The <span class="path">/?path=todo</span> view shows just your todos.</p>
  </div>
  <div class="tile">
    <div class="label">A note about a specific store</div>
    <p>Write it on the store's page (<span class="path">/stores/:id</span>) and include <code>#&lt;storename&gt;</code> in the text. The whole team sees it.</p>
  </div>
  <div class="tile">
    <div class="label">Something the manager needs to action</div>
    <p>A request, not a note. Use the Requests panel composer.</p>
  </div>
</div>

<h2 class="section"><span class="num">5</span>What you don't do</h2>
<div class="callout note">
You can't change a request's status (that's the manager). You can't archive or delete a store. You can't post team announcements. <strong>That's by design</strong> — you bring the work in, your manager closes it out. Keeps the audit clean.
</div>

<h2 class="section"><span class="num">6</span>You're ready when…</h2>
<ul class="checklist">
  <li>You've onboarded one real store through the wizard.</li>
  <li>You've opened at least one request and watched its status update.</li>
  <li>You can name the difference between a personal note (on <span class="path">/</span>) and a store note (on <span class="path">/stores/:id</span>).</li>
  <li>You know to paste owner messages verbatim, not summarize.</li>
  <li>You've tried <span class="path">/ai</span> for one "find that thing" question.</li>
  <li>You've skimmed the main <strong>BouldHQ Walkthrough</strong> in this same folder.</li>
</ul>

<footer class="next">
  <strong>Need something done?</strong> Open a request against the right store. Don't DM the manager directly — the request is the audit trail, and a triaged request gets handled faster than a missed message.
</footer>

</div></body></html>`;

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { FileService } = await import('../server/lib/files');

  const p = new PrismaClient();
  try {
    const founder = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
    if (!founder) throw new Error('No account found');

    const seeds: Array<{ name: string; html: string }> = [
      { name: 'BouldHQ_Onboarding_Founder.html',  html: FOUNDER_HTML  },
      { name: 'BouldHQ_Onboarding_Manager.html',  html: MANAGER_HTML  },
      { name: 'BouldHQ_Onboarding_Salesman.html', html: SALESMAN_HTML },
    ];

    const results: any[] = [];
    for (const s of seeds) {
      // Idempotent replace.
      const existing = await p.attachments.findFirst({
        where: { accountId: founder.id, perfixPath: TARGET_FOLDER, name: s.name },
      });
      if (existing) {
        await FileService.deleteFile(existing.path).catch((e: any) =>
          console.warn(`cleanup of ${s.name} failed (continuing):`, e?.message ?? e),
        );
      }
      const buffer = Buffer.from(s.html, 'utf8');
      const upl = await FileService.uploadFile({
        buffer, originalName: s.name, type: 'text/html', accountId: founder.id,
      });
      const created = await p.attachments.findFirst({
        where: { accountId: founder.id, path: upl.filePath },
      });
      if (!created) throw new Error(`attachment row missing after upload: ${s.name}`);
      await p.attachments.update({
        where: { id: created.id },
        data: { perfixPath: TARGET_FOLDER, depth: 1, type: 'text/html' },
      });
      results.push({ name: upl.fileName, sizeBytes: buffer.length, path: upl.filePath });
    }

    console.log(JSON.stringify({ folder: TARGET_FOLDER, accountId: founder.id, seeded: results }, null, 2));
    console.log('\n✓ onboarding guides seeded');
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
