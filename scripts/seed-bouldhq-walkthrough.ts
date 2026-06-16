// Generates a self-contained walkthrough HTML doc and files it under
// Resources → BouldHQ Setup Guides for the founder account.
// Idempotent: re-running replaces the existing file (matched by exact name).

// IMPORTANT: shared/lib/pathConstant.ts captures process.cwd() at import time
// to build UPLOAD_FILE_PATH. The server is started from server/, so this script
// must chdir into server/ BEFORE anything in the import graph touches that
// constant. We do that here, then dynamic-import the rest inside main() so
// pathConstant's top-level evaluation sees the corrected cwd.
import path from 'path';
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
if (process.cwd() !== SERVER_DIR) process.chdir(SERVER_DIR);

const TARGET_FOLDER = 'BouldHQ Setup Guides';
const FILE_NAME = 'BouldHQ_Walkthrough.html';

type FileServiceT = typeof import('../server/lib/files')['FileService'];
type BouldhqLib  = typeof import('../server/lib/bouldhq');
type PrismaT     = typeof import('@prisma/client')['PrismaClient'];

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>BouldHQ — Operator Walkthrough</title>
<style>
  :root {
    --bg: #0d1117;
    --bg-soft: #161b22;
    --bg-elev: #1c2128;
    --border: #30363d;
    --border-soft: #21262d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-dim: #6e7681;
    --accent: #58a6ff;
    --warn: #d29922;
    --good: #3fb950;
    --bad: #f85149;
    --founder: #d29922;
    --manager: #58a6ff;
    --salesman: #8b949e;
    --mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --bg-soft: #f6f8fa;
      --bg-elev: #ffffff;
      --border: #d0d7de;
      --border-soft: #e1e4e8;
      --text: #1f2328;
      --text-muted: #57606a;
      --text-dim: #6e7781;
      --accent: #0969da;
      --warn: #9a6700;
      --good: #1a7f37;
      --bad: #cf222e;
      --founder: #9a6700;
      --manager: #0969da;
      --salesman: #57606a;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
  body {
    font: 14.5px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px 24px 80px; display: grid; grid-template-columns: 220px 1fr; gap: 32px; }
  @media (max-width: 880px) { .wrap { grid-template-columns: 1fr; } nav.toc { display: none; } }

  /* --- Sticky TOC --- */
  nav.toc {
    position: sticky; top: 16px; align-self: start;
    font-size: 12.5px; line-height: 1.55;
    padding: 16px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg-soft);
    max-height: calc(100vh - 32px); overflow: auto;
  }
  nav.toc h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 8px; color: var(--text-muted); font-weight: 600; }
  nav.toc ol { list-style: none; padding: 0; margin: 0; }
  nav.toc li { margin: 0; }
  nav.toc a { display: block; padding: 4px 6px; color: var(--text-muted); text-decoration: none; border-radius: 4px; }
  nav.toc a:hover { background: var(--bg-elev); color: var(--text); }
  nav.toc .sub { margin-left: 10px; font-size: 11.5px; }

  /* --- Sections --- */
  main { min-width: 0; }
  header.hero { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
  header.hero .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-bottom: 6px; }
  header.hero h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.15; letter-spacing: -.01em; }
  header.hero p.lead { margin: 0; color: var(--text-muted); max-width: 70ch; }
  header.hero .meta { margin-top: 12px; font-family: var(--mono); font-size: 11px; color: var(--text-dim); }

  h2.section { margin: 40px 0 14px; font-size: 20px; letter-spacing: -.005em; }
  h2.section .num { color: var(--text-dim); font-family: var(--mono); margin-right: 8px; font-size: 14px; vertical-align: 1px; }
  h3.sub { margin: 24px 0 8px; font-size: 15px; color: var(--text); }
  p { margin: 0 0 12px; }

  /* --- Cards --- */
  .grid-cols-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .grid-cols-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  @media (max-width: 700px) { .grid-cols-3, .grid-cols-2 { grid-template-columns: 1fr; } }
  .card {
    background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 8px;
    padding: 14px;
  }
  .card h4 { margin: 0 0 6px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .card p { margin: 0; font-size: 13px; color: var(--text-muted); }

  /* --- Role badges --- */
  .role { display: inline-block; padding: 1px 7px; border-radius: 999px; font: 600 11px/1.6 system-ui; vertical-align: 1px; }
  .role.founder { background: rgba(210,153,34,.15); color: var(--founder); border: 1px solid rgba(210,153,34,.35); }
  .role.manager { background: rgba(88,166,255,.12); color: var(--manager); border: 1px solid rgba(88,166,255,.32); }
  .role.salesman { background: rgba(139,148,158,.14); color: var(--salesman); border: 1px solid rgba(139,148,158,.3); }
  .role.all { background: transparent; color: var(--text); border: 1px dashed var(--border); }

  /* --- Inline atoms --- */
  code, kbd { font: 12.5px var(--mono); background: var(--bg-soft); border: 1px solid var(--border-soft); padding: 1px 5px; border-radius: 4px; color: var(--text); }
  kbd { background: var(--bg-elev); }
  .path { font: 12.5px var(--mono); color: var(--accent); }
  .pill { display: inline-block; font: 600 10.5px/1.6 system-ui; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-muted); vertical-align: 1px; }

  /* --- Tables --- */
  table.matrix {
    width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0 4px;
    border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  }
  table.matrix th, table.matrix td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border-soft); }
  table.matrix th { background: var(--bg-soft); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  table.matrix tr:last-child td { border-bottom: none; }
  table.matrix td.act { color: var(--text); font-weight: 500; }
  .yes { color: var(--good); font-weight: 700; }
  .no { color: var(--text-dim); }
  .partial { color: var(--warn); }

  /* --- Definition lists --- */
  dl.kv { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
  dl.kv dt { color: var(--text-muted); font-family: var(--mono); font-size: 12px; padding-top: 1px; }
  dl.kv dd { margin: 0; }

  /* --- Callouts --- */
  .callout { border-left: 3px solid var(--accent); background: var(--bg-soft); padding: 10px 14px; border-radius: 4px; font-size: 13px; margin: 12px 0; }
  .callout.warn { border-left-color: var(--warn); }
  .callout.note { border-left-color: var(--text-muted); }

  /* --- Status pills --- */
  .status { display: inline-block; padding: 1px 7px; border-radius: 999px; font: 600 11px/1.6 var(--mono); border: 1px solid var(--border); }
  .status.pending  { color: var(--text-muted); background: var(--bg-elev); }
  .status.running  { color: var(--accent);     background: rgba(88,166,255,.12); border-color: rgba(88,166,255,.32); }
  .status.auto     { color: var(--good);       background: rgba(63,185,80,.12); border-color: rgba(63,185,80,.3); }
  .status.needs    { color: var(--warn);       background: rgba(210,153,34,.12); border-color: rgba(210,153,34,.32); }
  .status.in       { color: var(--accent);     background: var(--bg-soft); }
  .status.done     { color: var(--good);       background: var(--bg-soft); }

  /* --- Flow diagram (SVG) wrapper --- */
  .diagram { background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 8px; padding: 16px; margin: 12px 0; overflow-x: auto; }
  .diagram svg { width: 100%; min-width: 760px; height: auto; display: block; }

  /* --- Collapsibles --- */
  details { background: var(--bg-soft); border: 1px solid var(--border-soft); border-radius: 8px; padding: 0 14px; margin: 8px 0; }
  details summary { padding: 10px 0; cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
  details summary::-webkit-details-marker { display: none; }
  details summary::before { content: "▸"; color: var(--text-muted); font-size: 11px; transition: transform .15s; }
  details[open] summary::before { transform: rotate(90deg); }
  details > *:not(summary) { padding-bottom: 12px; font-size: 13px; }

  /* --- Aside / margin notes --- */
  .with-aside { display: grid; grid-template-columns: 1fr 220px; gap: 18px; align-items: start; }
  @media (max-width: 880px) { .with-aside { grid-template-columns: 1fr; } }
  aside.note { font-size: 12px; color: var(--text-muted); padding: 10px 12px; background: var(--bg-soft); border-radius: 6px; border-left: 2px solid var(--border); }
  aside.note .label { display: block; font-weight: 600; color: var(--text); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }

  ul.tight { margin: 6px 0 12px; padding-left: 18px; }
  ul.tight li { margin: 2px 0; }
  hr.soft { border: none; border-top: 1px solid var(--border-soft); margin: 32px 0; }

  /* --- Anchor offsets --- */
  section[id] { scroll-margin-top: 12px; }
</style>
</head>
<body>
<div class="wrap">

<nav class="toc" aria-label="Table of contents">
  <h2>Walkthrough</h2>
  <ol>
    <li><a href="#tldr">0 · TL;DR</a></li>
    <li><a href="#big-picture">1 · The big picture</a></li>
    <li><a href="#roles">2 · Roles &amp; permissions</a></li>
    <li><a href="#pages">3 · Pages</a>
      <ol class="sub">
        <li><a href="#p-hq">3.1 /hq Dashboard</a></li>
        <li><a href="#p-stores">3.2 /stores</a></li>
        <li><a href="#p-store-new">3.3 /stores/new</a></li>
        <li><a href="#p-store-detail">3.4 /stores/:tagId</a></li>
        <li><a href="#p-home">3.5 / personal</a></li>
        <li><a href="#p-resources">3.6 /resources</a></li>
        <li><a href="#p-ai">3.7 /ai assistant</a></li>
      </ol>
    </li>
    <li><a href="#lifecycle">4 · Lifecycles</a>
      <ol class="sub">
        <li><a href="#lc-onboard">4.1 Onboard a store</a></li>
        <li><a href="#lc-request">4.2 Request &amp; triage</a></li>
        <li><a href="#lc-archive">4.3 Archive / delete</a></li>
      </ol>
    </li>
    <li><a href="#data-model">5 · Data model</a></li>
    <li><a href="#workflow-by-role">6 · A day in the life</a></li>
    <li><a href="#glossary">7 · Glossary</a></li>
    <li><a href="#faq">8 · FAQ &amp; gotchas</a></li>
  </ol>
</nav>

<main>

<header class="hero">
  <div class="eyebrow">Internal operator guide · v1.0</div>
  <h1>BouldHQ — how it works, who sees what, end to end</h1>
  <p class="lead">BouldHQ is an internal ops platform for running a roster of Shopify stores. Salesmen onboard new store owners, an AI triages each request, the manager (or an automated playbook) executes the fix, and the team's history of every store lives on one page. This document is the reference walkthrough for everyone on the team.</p>
  <div class="meta">last updated: walkthrough seeded by setup script · self-contained HTML · open offline-friendly</div>
</header>

<!-- =================================================================== -->
<section id="tldr">
<h2 class="section"><span class="num">0</span>TL;DR by role</h2>
<div class="grid-cols-3">
  <div class="card">
    <h4><span class="role founder">founder</span> Sees everything</h4>
    <p>Posts global announcements, creates and deletes teams, archives / permanently deletes stores. Promotes managers and salesmen. Receives every team's pinned weekly tracker.</p>
  </div>
  <div class="card">
    <h4><span class="role manager">manager</span> Runs the ops console</h4>
    <p>Triages incoming requests, opens the per-store terminal, runs / re-runs playbooks, marks requests done. Archives or restores stores. Posts team-scoped announcements.</p>
  </div>
  <div class="card">
    <h4><span class="role salesman">salesman</span> Onboards &amp; intakes</h4>
    <p>Creates new stores via the wizard, pastes store-owner messages as requests, follows up. Cannot change request status, archive, delete, or post announcements.</p>
  </div>
</div>
</section>

<!-- =================================================================== -->
<section id="big-picture">
<h2 class="section"><span class="num">1</span>The big picture</h2>
<p>Every store the team manages is one row in the database (a <code>tag</code> with <code>parent=0</code>). Attached to that row are the store's profile, requests, notes, and a per-store working directory for the agent manager's terminal. The lifecycle below is the same for every store you onboard.</p>

<div class="diagram" aria-label="Workflow diagram">
<svg viewBox="0 0 920 220" role="img" aria-labelledby="flowtitle">
<title id="flowtitle">Salesman → AI triage → automated playbook or human manager → done</title>
<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
  </marker>
</defs>
<style>
  .node { fill: var(--bg-elev); stroke: var(--border); stroke-width: 1; }
  .node-text { fill: var(--text); font: 600 12px system-ui; }
  .node-sub  { fill: var(--text-muted); font: 11px system-ui; }
  .arrow { stroke: var(--text-muted); stroke-width: 1.5; fill: none; }
  .node.auto { stroke: var(--good); }
  .node.human { stroke: var(--warn); }
  .node.done { stroke: var(--accent); }
</style>

<!-- Salesman -->
<rect class="node" x="20" y="80" width="160" height="60" rx="6"/>
<text class="node-text" x="100" y="105" text-anchor="middle">Salesman</text>
<text class="node-sub" x="100" y="123" text-anchor="middle">paste msg / email / OCR</text>

<!-- AI triage -->
<rect class="node" x="220" y="80" width="160" height="60" rx="6"/>
<text class="node-text" x="300" y="105" text-anchor="middle">AI triage</text>
<text class="node-sub" x="300" y="123" text-anchor="middle">automate vs human</text>

<!-- Branch up: playbook -->
<rect class="node auto" x="420" y="20" width="180" height="60" rx="6"/>
<text class="node-text" x="510" y="45" text-anchor="middle">Playbook runs</text>
<text class="node-sub" x="510" y="63" text-anchor="middle">dns_check / collab_invite / …</text>

<!-- Branch down: manager -->
<rect class="node human" x="420" y="140" width="180" height="60" rx="6"/>
<text class="node-text" x="510" y="165" text-anchor="middle">Manager workspace</text>
<text class="node-sub" x="510" y="183" text-anchor="middle">terminal · ops console</text>

<!-- Done -->
<rect class="node done" x="640" y="80" width="160" height="60" rx="6"/>
<text class="node-text" x="720" y="105" text-anchor="middle">Done</text>
<text class="node-sub" x="720" y="123" text-anchor="middle">store history retained</text>

<!-- Arrows -->
<path class="arrow" d="M180 110 H 220" marker-end="url(#arr)"/>
<path class="arrow" d="M380 100 C 400 100, 400 50, 420 50" marker-end="url(#arr)"/>
<path class="arrow" d="M380 120 C 400 120, 400 170, 420 170" marker-end="url(#arr)"/>
<path class="arrow" d="M600 50 C 620 50, 620 100, 640 100" marker-end="url(#arr)"/>
<path class="arrow" d="M600 170 C 620 170, 620 120, 640 120" marker-end="url(#arr)"/>
</svg>
</div>

<div class="with-aside">
<p>The split happens at the AI triage step. A request whose category maps to a known playbook (e.g. <code>dns_record_check</code>) runs end-to-end without human intervention. Anything ambiguous, creative, or strategic flips to <span class="status needs">needs_assistance</span> and lands in the manager's queue.</p>
<aside class="note"><span class="label">No LLM?</span> If no provider is configured, triage gracefully writes <span class="status needs">needs_assistance</span>. Nothing gets stuck.</aside>
</div>
</section>

<!-- =================================================================== -->
<section id="roles">
<h2 class="section"><span class="num">2</span>Roles &amp; permissions matrix</h2>
<p>Roles live on the <code>teamMember</code> row, not the user. The same person can be a manager in one team and a salesman in another — the active team determines what they can do <em>right now</em>. The matrix below shows what each role can do within their active team.</p>

<table class="matrix">
<thead>
<tr>
  <th>Action</th>
  <th>Salesman</th>
  <th>Manager</th>
  <th>Founder</th>
</tr>
</thead>
<tbody>
<tr><td class="act">View team store list</td>      <td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Create a store (wizard)</td>   <td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Submit a request</td>          <td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Edit store profile</td>        <td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Change request status</td>     <td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Re-run triage / playbook</td>  <td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Open the ops console (terminal)</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Post team announcement</td>    <td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Pin / delete an announcement</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Archive / restore a store</td> <td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Invite member (manager / salesman)</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
<tr><td class="act">Post <em>global</em> announcement</td><td class="no">—</td><td class="no">—</td><td class="yes">✓</td></tr>
<tr><td class="act">Promote a member to founder</td><td class="no">—</td><td class="no">—</td><td class="yes">✓</td></tr>
<tr><td class="act">Delete store permanently</td>  <td class="no">—</td><td class="no">—</td><td class="yes">✓</td></tr>
<tr><td class="act">Create a new team</td>         <td class="no">—</td><td class="no">—</td><td class="yes">✓</td></tr>
</tbody>
</table>

<div class="callout note">A salesman who needs something done flips to "Manager, can you take a look?" by pasting a request — they never directly modify a request once submitted. This keeps the audit trail clean.</div>
</section>

<!-- =================================================================== -->
<section id="pages">
<h2 class="section"><span class="num">3</span>Pages</h2>

<h3 class="sub" id="p-hq">3.1 <span class="path">/hq</span> — BouldHQ Dashboard <span class="role all">everyone</span></h3>
<p>The team's home page. Strictly read-only from a salesman's perspective; manager+ can post here.</p>
<dl class="kv">
  <dt>Heads up</dt><dd>System-generated notes (weekly tracker, future checkup notes). Pulled from your account's <code>metadata.bouldhqSystem=true</code> notes. Hidden from your personal feed; surfaces only here.</dd>
  <dt>Snapshot</dt><dd>4 stat tiles: stores managed, new this month, reviewed this month, open requests. The open-requests tile clicks through to <code>/stores?filter=open</code> when nonzero.</dd>
  <dt>Team roster</dt><dd>Every member of your active team with role chip + avatar.</dd>
  <dt>Announcements</dt><dd>Posts in three categories: <code>announcement</code>, <code>workflow_update</code>, <code>changelog</code>. Pinned items float to the top.</dd>
</dl>

<hr class="soft"/>

<h3 class="sub" id="p-stores">3.2 <span class="path">/stores</span> — Store list <span class="role all">everyone</span></h3>
<p>Compact table of every active store in your team. Click a row to drill in.</p>
<ul class="tight">
  <li><strong>Search</strong> by name or URL.</li>
  <li><strong>Show archived</strong> toggle (<code>?archived=1</code>) reveals dimmed archived rows.</li>
  <li><strong>"open"</strong> filter (<code>?filter=open</code>) restricts to stores with at least one open request — the HQ tile auto-applies this.</li>
  <li><strong>New store</strong> button opens the wizard.</li>
</ul>
<p>Sort: active stores first, then by open-request count desc, then alphabetical.</p>

<hr class="soft"/>

<h3 class="sub" id="p-store-new">3.3 <span class="path">/stores/new</span> — Wizard <span class="role all">everyone</span></h3>
<p>Four-step intake. Step gating means you cannot continue if the step is invalid.</p>
<table class="matrix">
<thead><tr><th>Step</th><th>Required</th><th>What lands in the DB</th></tr></thead>
<tbody>
<tr><td class="act">1. Identity</td><td>name (no spaces, no <code>#</code>, no <code>/</code>)</td><td>Top-level tag with <code>teamId</code>; optional logo upload filed to Branding Assets folder.</td></tr>
<tr><td class="act">2. Shopify access</td><td>—</td><td>StoreProfile row: storeUrl, collab access toggle, admin URL, 4-digit code, plan, renewal date.</td></tr>
<tr><td class="act">3. Requirements</td><td>raw body if toggle on</td><td>If you keep "Open the first request now" on: a <span class="status pending">pending_triage</span> storeRequest seeded with the verbatim message.</td></tr>
<tr><td class="act">4. Review</td><td>—</td><td>Single transaction on submit. Atomic — failures roll back.</td></tr>
</tbody>
</table>
<p>Side effects fired outside the transaction (best-effort, idempotent): branding folder seed, bootstrap of <em>Welcome</em> + <em>Onboarding checklist</em> notes tagged with the new store.</p>

<hr class="soft"/>

<h3 class="sub" id="p-store-detail">3.4 <span class="path">/stores/:tagId</span> — Store ops <span class="role all">everyone reads · manager+ writes</span></h3>
<p>The team's shared workspace for one store. Top-to-bottom layout:</p>
<dl class="kv">
  <dt>Header</dt><dd>Store name + archive banner if archived. Dots menu opens archive / delete actions (manager+ for archive, founder for delete).</dd>
  <dt>StoreProfileCard</dt><dd>Editable: logo, URL, plan, renewal, collaborator code. Auto-saved (debounced 500ms).</dd>
  <dt>Requests panel</dt><dd>Filter chips (All / Open / Needs assistance / In progress / Auto done / Done), composer modal, expand-row detail with triage breakdown, run log, manager actions.</dd>
  <dt>Ops Console</dt><dd><span class="role manager">manager</span> + <span class="role founder">founder</span> only. xterm.js terminal connected via WebSocket to a shell scoped to <code>.bouldhq-workdirs/team-N/store-M/</code>. Type <code>claude</code> to start an agent session inside the store's working dir.</dd>
  <dt>Notes</dt><dd>Team-wide editor + masonry of every note tagged with this store, from any team member.</dd>
</dl>

<hr class="soft"/>

<h3 class="sub" id="p-home">3.5 <span class="path">/</span> — Personal home <span class="role all">everyone</span></h3>
<p>Your private kanban. Strictly notes you own that are <em>not</em> tagged with a team-store and <em>not</em> flagged as a system note.</p>
<ul class="tight">
  <li><code>/?path=notes</code> — only type=note</li>
  <li><code>/?path=todo</code> — only todos, grouped by date</li>
  <li><code>/?path=archived</code> — archived personal notes</li>
  <li><code>/?path=trash</code> — recycle bin</li>
</ul>
<div class="callout warn">A note you tag with <code>#&lt;storename&gt;</code> automatically moves to that store's page and stops appearing here. To bring it back, remove the hashtag.</div>

<hr class="soft"/>

<h3 class="sub" id="p-resources">3.6 <span class="path">/resources</span> — Files <span class="role all">everyone</span></h3>
<p>Folder-based file panel. The default folder set is auto-created per account on bootstrap:</p>
<ul class="tight">
  <li><code>SOPs</code></li>
  <li><code>Onboarding Templates</code></li>
  <li><code>AI Prompt Library</code></li>
  <li><code>Branding Assets</code> &nbsp;<span class="pill">auto-creates a subfolder per store</span></li>
  <li><code>Sales Documents</code></li>
  <li><code>Shopify AI Toolkit Prompts</code></li>
  <li><code>BouldHQ Setup Guides</code> &nbsp;<span class="pill">this document lives here</span></li>
</ul>
<p>The top of the page carries a one-click link to <span class="path">/ai</span> — when you can't find a thing, the assistant can search resources directly.</p>

<hr class="soft"/>

<h3 class="sub" id="p-ai">3.7 <span class="path">/ai</span> — BouldHQ Assistant <span class="role all">everyone</span></h3>
<p>Scoped agent. Refuses anything outside its three jobs.</p>
<div class="grid-cols-3">
  <div class="card"><h4>Ask about the app</h4><p>Pages, roles, the request flow, the ops console — how things connect.</p></div>
  <div class="card"><h4>Find a thing</h4><p>Searches your Resources by name + folder; searches your notes via semantic RAG.</p></div>
  <div class="card"><h4>Save a task</h4><p>"Open a task for Joon: …" creates a real <code>storeRequest</code> against that store. AI triage fires immediately.</p></div>
</div>
</section>

<!-- =================================================================== -->
<section id="lifecycle">
<h2 class="section"><span class="num">4</span>Lifecycles</h2>

<h3 class="sub" id="lc-onboard">4.1 Onboarding a new store (from intake to first request)</h3>
<details open>
<summary>Step-by-step timeline</summary>
<dl class="kv">
  <dt>T+0 · salesman</dt><dd>Hits <span class="path">/stores</span> → New store → wizard step 1.</dd>
  <dt>T+0 · wizard</dt><dd>Validates name uniqueness against team. Optional logo upload writes to disk + attachments row.</dd>
  <dt>T+0 · submit</dt><dd>Atomic transaction: tag + storeProfile + (optional) initial storeRequest.</dd>
  <dt>T+1s · server</dt><dd>Fire-and-forget side effects: Branding Assets/&lt;store&gt; folder, Welcome note, Onboarding checklist note. AI triages the initial request if one was opened.</dd>
  <dt>T+~3s · redirect</dt><dd>Wizard navigates to <span class="path">/stores/:newTagId</span>. The store's notes feed already shows the two seeded notes.</dd>
  <dt>T+~5s · status</dt><dd>If triage marked the initial request automatable, you'll see status flip from <span class="status pending">pending_triage</span> through <span class="status running">auto_running</span> to <span class="status auto">auto_done</span> or <span class="status needs">needs_assistance</span>.</dd>
</dl>
</details>

<h3 class="sub" id="lc-request">4.2 A request from intake to closed</h3>
<details>
<summary>Status state machine</summary>
<table class="matrix" style="font-size: 12.5px;">
<thead><tr><th>From</th><th>To</th><th>Trigger</th><th>Actor</th></tr></thead>
<tbody>
<tr><td><span class="status pending">pending_triage</span></td><td><span class="status running">auto_running</span></td><td>AI judged automatable + category in known playbook list</td><td>system</td></tr>
<tr><td><span class="status pending">pending_triage</span></td><td><span class="status needs">needs_assistance</span></td><td>AI judged human-required, no LLM configured, or model errored</td><td>system</td></tr>
<tr><td><span class="status running">auto_running</span></td><td><span class="status auto">auto_done</span></td><td>Playbook returned <code>ok: true</code></td><td>runner</td></tr>
<tr><td><span class="status running">auto_running</span></td><td><span class="status needs">needs_assistance</span></td><td>Playbook returned <code>ok: false</code> or threw</td><td>runner</td></tr>
<tr><td><span class="status needs">needs_assistance</span></td><td><span class="status in">in_progress</span></td><td>Manager hits <strong>Take on</strong></td><td>manager</td></tr>
<tr><td><span class="status in">in_progress</span></td><td><span class="status done">done</span></td><td>Manager hits <strong>Mark done</strong></td><td>manager</td></tr>
<tr><td>any open</td><td><span class="status needs">needs_assistance</span></td><td>Manager hits <strong>Flag</strong></td><td>manager</td></tr>
<tr><td>any</td><td><span class="status running">auto_running</span></td><td>Manager hits <strong>Re-run playbook</strong> (resets log + closedAt)</td><td>manager</td></tr>
</tbody>
</table>
</details>

<details>
<summary>Available playbook categories</summary>
<dl class="kv">
  <dt>dns_record_check</dt><dd><strong>Real.</strong> Resolves the store URL, surfaces Shopify-edge match. No external auth.</dd>
  <dt>shopify_collab_invite</dt><dd>Simulated. Needs Shopify Admin API token per store to ship for real.</dd>
  <dt>theme_setting_tweak</dt><dd>Simulated.</dd>
  <dt>product_metadata_update</dt><dd>Simulated.</dd>
  <dt>inventory_sync_check</dt><dd>Simulated.</dd>
  <dt>shipping_rate_update</dt><dd>Simulated.</dd>
  <dt>app_install</dt><dd>Simulated.</dd>
  <dt>email_template_edit</dt><dd>Simulated.</dd>
  <dt>human_required</dt><dd>Goes straight to <span class="status needs">needs_assistance</span> — manager handles.</dd>
</dl>
<p>The simulated playbooks complete with a clear log warning that they did not perform real side effects. Replace each one with a real implementation in <code>server/lib/playbookRunner.ts</code> as needed.</p>
</details>

<h3 class="sub" id="lc-archive">4.3 Archive &amp; permanent delete</h3>
<div class="with-aside">
<p>"Delete" in BouldHQ is a two-step process designed to preserve audit history.</p>
<aside class="note"><span class="label">Why two steps?</span> A client relationship can be on pause for months and come back. Archive keeps every note, request, and run log intact.</aside>
</div>
<dl class="kv">
  <dt>Archive (manager+)</dt><dd>Sets <code>tag.archivedAt</code> + <code>archivedById</code>. Drops from <span class="path">/stores</span>, the team switcher, the assistant's <code>bouldhq-list-stores</code>, and open-request counts. The store's notes stay tagged.</dd>
  <dt>Restore (manager+)</dt><dd>Clears the archive columns. One click.</dd>
  <dt>Delete permanently (founder)</dt><dd>Requires typing the store name to confirm. Cascades <code>tag → storeProfile, storeRequests</code>. Notes survive — they simply lose the tag and fall back into the founder's personal feed.</dd>
</dl>
</section>

<!-- =================================================================== -->
<section id="data-model">
<h2 class="section"><span class="num">5</span>Data model (just enough)</h2>
<p>The five tables that matter most for understanding day-to-day:</p>
<dl class="kv">
  <dt>team</dt><dd>One row per team. Slug, name. Members join via <code>teamMember</code>.</dd>
  <dt>teamMember</dt><dd>The (account × team × role) tuple. Role is exactly one of <code>founder | manager | salesman</code>.</dd>
  <dt>tag</dt><dd>A store is a tag with <code>parent=0</code> + <code>teamId</code> set. Sub-tags (e.g. <code>Branding Assets/&lt;store&gt;</code>) point at the store via <code>parent</code>.</dd>
  <dt>storeProfile</dt><dd>1:1 with the store tag. Shopify URL, plan, collab code, logo path, renewal date.</dd>
  <dt>storeRequest</dt><dd>The triage/playbook unit. Carries <code>rawBody</code>, <code>triageResult</code> (JSON), <code>runLog</code> (JSON), <code>status</code>.</dd>
  <dt>notes</dt><dd>Owned by <code>accountId</code>. Tagged with zero or more tags via <code>tagsToNote</code>. System notes carry <code>metadata.bouldhqSystem=true</code>.</dd>
  <dt>announcement</dt><dd>Optional <code>teamId</code> (NULL = global). <code>category</code> drives which <span class="path">/hq</span> section it shows in.</dd>
</dl>
<div class="callout note">A note never belongs to a store. It belongs to the user. The store-tag is just a label that exposes the note to the team on that store's page.</div>
</section>

<!-- =================================================================== -->
<section id="workflow-by-role">
<h2 class="section"><span class="num">6</span>A day in the life</h2>

<details open>
<summary><span class="role salesman">salesman</span> Diego, onboarding a new client</summary>
<ol class="tight">
  <li>Opens <span class="path">/stores/new</span> → fills the wizard from a 20-minute discovery call.</li>
  <li>Submits. Lands on the store's ops page. Reviews the auto-generated Welcome + Onboarding checklist notes.</li>
  <li>Later that afternoon, the owner replies with brand colors. Diego pastes the email body into the Requests composer with source=<code>email</code>.</li>
  <li>AI triage classifies it as <code>theme_setting_tweak</code>. Status flips to <span class="status running">auto_running</span>, then (because the playbook is still simulated) to <span class="status auto">auto_done</span> with a log saying a real handler is needed.</li>
  <li>Diego pings the manager: "FYI, theme tweak landed in Joon, you'll want to actually run it."</li>
</ol>
</details>

<details>
<summary><span class="role manager">manager</span> Selma, handling the morning queue</summary>
<ol class="tight">
  <li>Opens <span class="path">/hq</span>. Heads-up section shows weekly store count + 3 open requests across two stores.</li>
  <li>Clicks the open-requests tile → <span class="path">/stores?filter=open</span> → opens Joon's detail.</li>
  <li>Requests panel shows two <span class="status needs">needs_assistance</span> rows. Expands the first, reads the customer's email + the AI's suggestion.</li>
  <li>Hits <strong>Take on</strong> → status moves to <span class="status in">in_progress</span>.</li>
  <li>Scrolls to the <strong>Ops Console</strong>, hits Connect. Lands in a shell at <code>.bouldhq-workdirs/team-1/store-8/</code>. Types <code>claude</code>, hands Claude the relevant context, runs the theme update.</li>
  <li>Verifies via <code>shopify theme</code> CLI, then hits <strong>Mark done</strong>. Status flips to <span class="status done">done</span>, <code>closedAt</code> timestamps the row.</li>
</ol>
</details>

<details>
<summary><span class="role founder">founder</span> Bafsr, end-of-week broadcast</summary>
<ol class="tight">
  <li>Hits <span class="path">/hq</span> → Announcements panel → <strong>Post</strong>.</li>
  <li>Category = <code>announcement</code>, Scope = Global (founder-only option), Pin = on.</li>
  <li>Body: "Q3 push starts Monday — let's hit 12 stores under management by end of month." Pin keeps it at the top for the whole team across every team in the org.</li>
  <li>Then opens <span class="path">/stores</span>, flips show-archived, restores a paused store that's coming back online.</li>
</ol>
</details>
</section>

<!-- =================================================================== -->
<section id="glossary">
<h2 class="section"><span class="num">7</span>Glossary</h2>
<dl class="kv">
  <dt>Store</dt><dd>A Shopify storefront the team manages. Modeled as a top-level tag inside a team.</dd>
  <dt>Team</dt><dd>A group of teammates (1 manager per ~20 stores, plus salesmen + the founder).</dd>
  <dt>Active team</dt><dd>Which team's data you're currently viewing. Switches via the avatar dropdown.</dd>
  <dt>Request</dt><dd>A unit of work raised against a store — a verbatim message from the store owner, an internal task, or a periodic check.</dd>
  <dt>Triage</dt><dd>The AI's decision on whether a request is automatable.</dd>
  <dt>Playbook</dt><dd>A registered async function that handles one category of request end-to-end.</dd>
  <dt>Ops Console</dt><dd>The browser terminal scoped to a per-store working directory. Manager+ only.</dd>
  <dt>Personal home</dt><dd><span class="path">/</span> — strictly the notes you own that aren't tagged with a team-store.</dd>
  <dt>System note</dt><dd>A note flagged <code>metadata.bouldhqSystem=true</code>. Hidden from personal home; surfaced on <span class="path">/hq</span> Heads-up.</dd>
</dl>
</section>

<!-- =================================================================== -->
<section id="faq">
<h2 class="section"><span class="num">8</span>FAQ &amp; gotchas</h2>

<details>
<summary>I added a note and it disappeared.</summary>
<p>Did you write a <code>#&lt;storename&gt;</code> hashtag? If so, the note moved to <span class="path">/stores/&lt;storename&gt;</span>. Remove the hashtag to bring it back to your personal feed.</p>
</details>

<details>
<summary>Why isn't the playbook actually doing the Shopify thing?</summary>
<p>Only <code>dns_record_check</code> is wired against the real internet today. Every other category falls through to a simulation that completes successfully with a clear "implement me" log. To ship a real one, add an entry to the registry in <code>server/lib/playbookRunner.ts</code>.</p>
</details>

<details>
<summary>I'm a manager but I don't see the Ops Console.</summary>
<p>Refresh — the role-fetch query failed silently. If it persists, your <code>teamMember</code> row may have <code>role='salesman'</code>. A founder can fix this via the team router's <code>updateRole</code> mutation (or Prisma Studio).</p>
</details>

<details>
<summary>The terminal shows my prompt but <code>vim</code> looks broken.</summary>
<p>Expected. The terminal runs over <code>Bun.spawn</code> with stdin/stdout pipes — not a real PTY — because node-pty's native bindings don't load under Bun. Line-oriented tools (<code>claude</code>, <code>bash</code>, <code>git</code>, <code>npm</code>, <code>shopify</code>) work fine. Full-TTY tools (<code>vim</code>, <code>less</code>, <code>htop</code>) won't render. Use the IDE / Cursor / VS Code over SSH for those.</p>
</details>

<details>
<summary>The weekly tracker note is missing on /hq.</summary>
<p>It's created lazily on the first call to <span class="path">/hq</span> for your account. If it still doesn't show, hit the <code>bouldhq.refreshWeeklyTracker</code> mutation — it's idempotent.</p>
</details>

<details>
<summary>I deleted a store by accident.</summary>
<p>If you <em>archived</em> it, just toggle show-archived on <span class="path">/stores</span> and hit Restore. If you used founder delete and confirmed the typed name, the tag and its requests are gone, but every note that was tagged with the store survived — they're in your personal feed now, just without the tag. You can re-create the store and re-tag the notes.</p>
</details>

</section>

</main>
</div>
</body>
</html>
`;

async function main() {
  // Dynamic imports: see top-of-file comment for why this can't be top-level.
  const { PrismaClient } = await import('@prisma/client');
  const { FileService } = await import('../server/lib/files');
  const { ensureBrandingFolderForTag } = await import('../server/lib/bouldhq');

  const p = new PrismaClient();
  const founder = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!founder) throw new Error('No account found');

  // Make sure the default folders are seeded for this account so the file
  // lands inside an existing folder.
  await ensureBrandingFolderForTag(founder.id, 'placeholder').catch(() => undefined);

  // Idempotent replace: delete any existing copy of the doc under the same folder.
  const existing = await p.attachments.findFirst({
    where: { accountId: founder.id, perfixPath: TARGET_FOLDER, name: FILE_NAME },
  });
  if (existing) {
    await FileService.deleteFile(existing.path).catch((e: any) =>
      console.warn('cleanup of prior copy failed (continuing):', e?.message ?? e),
    );
  }

  const buffer = Buffer.from(html, 'utf8');
  const result = await FileService.uploadFile({
    buffer,
    originalName: FILE_NAME,
    type: 'text/html',
    accountId: founder.id,
  });

  const created = await p.attachments.findFirst({
    where: { accountId: founder.id, path: result.filePath },
  });
  if (!created) throw new Error('attachment row not found after upload');

  await p.attachments.update({
    where: { id: created.id },
    data: { perfixPath: TARGET_FOLDER, depth: 1, type: 'text/html' },
  });

  console.log(JSON.stringify({
    fileName: result.fileName,
    physicalPath: result.filePath,
    folder: TARGET_FOLDER,
    sizeBytes: buffer.length,
    accountId: founder.id,
  }, null, 2));
  console.log('\n✓ walkthrough seeded under Resources → ' + TARGET_FOLDER);
  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); process.exit(1); });
