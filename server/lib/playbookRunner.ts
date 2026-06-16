// BouldHQ — playbook runner.
//
// The autonomous agent runs in the SAME folder where Brian does manual work
// for that store: `~/.bouldhq-workdirs/<store-name>/`. The theme is auto-
// discovered (the single `theme_export__*/` git checkout in that folder).
// Everything BouldHQ owns lives in a `.bouldhq/` subfolder so it doesn't
// pollute the creative workspace. The agent reads CLAUDE.md at the store
// root, then the per-run files in `.bouldhq/`, and either ships a fix by
// committing + pushing in the theme repo, or hands back a structured brief
// with `result.json`.

import { promises as dns } from 'dns';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { prisma } from '@server/prisma';
import { UPLOAD_FILE_PATH } from '@shared/lib/pathConstant';

const WORKDIR_ROOT = process.env.BOULDHQ_WORKDIR_ROOT
  || path.join(os.homedir(), '.bouldhq-workdirs');
const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN || 'claude';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_CODE_TIMEOUT_MS || 10 * 60 * 1000);

// Agent tool allowlist. Read/Edit/Write/MultiEdit operate within cwd by
// nature, so the workspace boundary is enforced by where we cd. Bash is
// pinned to the operations the agent legitimately needs to ship a theme fix:
// git ops to commit + push, navigation, and the Shopify CLI if installed.
const CLAUDE_ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob', 'WebFetch',
  'Edit', 'Write', 'MultiEdit',

  // git deploy loop — Shopify auto-deploys on push to the connected branch
  'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)',
  'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git push:*)',
  'Bash(git branch:*)', 'Bash(git checkout:*)', 'Bash(git stash:*)',
  'Bash(git restore:*)', 'Bash(git -C:*)',

  // navigation + read-only inspection
  'Bash(cd:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(pwd:*)', 'Bash(find:*)',
  'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(file:*)',

  // optional Shopify CLI for theme check, dev preview, etc.
  'Bash(shopify:*)',

  // sanity / network inspection
  'Bash(curl:*)', 'Bash(dig:*)', 'Bash(nslookup:*)', 'Bash(host:*)',
].join(',');

// ---------- Types -----------------------------------------------------------

export type PlaybookStep = {
  at: string;
  level: 'info' | 'ok' | 'warn' | 'fail';
  message: string;
};

export type HumanBrief = {
  title: string;
  checklist: string[];
  context_for_human: string;
};

export type AgentAction = {
  kind: 'note_created' | 'note_updated' | 'file_drafted' | 'theme_pushed' | 'other';
  title?: string;
  file?: string;
  noteId?: number;
  preview?: string;
  commit?: string;
};

export type PlaybookOutcome = {
  status: 'auto_done' | 'needs_assistance' | 'blocked';
  summary: string;
  steps: PlaybookStep[];
  brief?: HumanBrief;
  actions?: AgentAction[];
  questions?: string[];
};

type PlaybookContext = {
  requestId: number;
  tagId: number;
  teamId: number;
  rawBody: string;
  triageResult: any;
  storeUrl: string | null;
  storeName: string;
};

type Playbook = (ctx: PlaybookContext) => Promise<PlaybookOutcome>;

const step = (level: PlaybookStep['level'], message: string): PlaybookStep => ({
  at: new Date().toISOString(),
  level,
  message,
});

// ---------- Path resolution -------------------------------------------------

// Map a tag name to the disk folder Brian actually uses. All current stores
// are lowercase versions of the tag name (jck.approved, adophies, etc.).
function storeFolderName(storeName: string): string {
  return storeName.toLowerCase().trim();
}

async function storeRoot(storeName: string): Promise<string> {
  const dir = path.join(WORKDIR_ROOT, storeFolderName(storeName));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Find the theme repo inside a store folder. Convention: a single
// `theme_export__<myshopify>__<DATE>/` subdirectory with .git. If multiple
// (Brian re-exported), pick the most recently modified. Returns null if
// none is present.
async function discoverThemeRepo(root: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch { return null; }
  const candidates: Array<{ p: string; mtime: number }> = [];
  for (const name of entries) {
    if (!name.startsWith('theme_export__')) continue;
    const p = path.join(root, name);
    try {
      const stat = await fs.stat(p);
      if (!stat.isDirectory()) continue;
      const gitStat = await fs.stat(path.join(p, '.git')).catch(() => null);
      if (!gitStat) continue;
      candidates.push({ p, mtime: stat.mtimeMs });
    } catch {}
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].p;
}

// ---------- dns_record_check (unchanged real implementation) ----------------

const dnsRecordCheck: Playbook = async (ctx) => {
  const steps: PlaybookStep[] = [];
  if (!ctx.storeUrl) {
    steps.push(step('fail', 'No storeUrl set on the storeProfile — cannot check DNS.'));
    return { status: 'blocked', summary: 'Missing storeUrl', steps };
  }
  const host = ctx.storeUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  if (!host) {
    return { status: 'blocked', summary: 'Unparseable storeUrl', steps: [step('fail', `Could not extract a host from "${ctx.storeUrl}".`)] };
  }
  steps.push(step('info', `Checking DNS for ${host}`));
  let aRecords: string[] = [];
  let cnameTarget: string | null = null;
  try { aRecords = await dns.resolve4(host); steps.push(step('ok', `A records: ${aRecords.join(', ')}`)); }
  catch (e: any) { steps.push(step('warn', `No A records (${e.code ?? e.message ?? 'error'}).`)); }
  try { const cnames = await dns.resolveCname(host); cnameTarget = cnames[0] ?? null;
    if (cnameTarget) steps.push(step('ok', `CNAME → ${cnameTarget}`));
  } catch (e: any) {
    if (aRecords.length === 0) {
      steps.push(step('fail', `No A or CNAME records resolvable (${e.code ?? e.message}).`));
      return { status: 'blocked', summary: `${host} does not resolve`, steps };
    }
  }
  const looksShopify = cnameTarget?.includes('myshopify.com') || aRecords.some((ip) => ip.startsWith('23.227.38.'));
  steps.push(looksShopify ? step('ok', 'Resolution looks Shopify-managed.') : step('warn', 'Resolution does NOT look Shopify-managed.'));
  return { status: 'auto_done', summary: `DNS resolves for ${host}${looksShopify ? ' (Shopify edge detected)' : ''}`, steps };
};

// ---------- Workspace materialization ---------------------------------------

function fileSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';
}

async function resetEphemeral(root: string): Promise<void> {
  const ephemeral = path.join(root, '.bouldhq');
  for (const sub of ['requests', 'notes']) {
    try { await fs.rm(path.join(ephemeral, sub), { recursive: true, force: true }); } catch {}
  }
  try { await fs.rm(path.join(ephemeral, 'store-info.md'), { force: true }); } catch {}
  try { await fs.rm(path.join(ephemeral, 'result.json'), { force: true }); } catch {}
}

async function writeStoreInfo(root: string, ctx: PlaybookContext, themeDir: string | null): Promise<void> {
  const ephemeral = path.join(root, '.bouldhq');
  await fs.mkdir(ephemeral, { recursive: true });
  const lines = [
    `# ${ctx.storeName}`,
    '',
    `- **Store URL**: ${ctx.storeUrl ?? '(not configured)'}`,
    `- **Theme folder**: ${themeDir ? path.relative(root, themeDir) : '(no theme_export__*/ found)'}`,
    `- **Internal store id**: ${ctx.tagId}`,
    '',
    'You are the dedicated operations agent for this store. The theme is a',
    'git checkout connected to Shopify via the GitHub deploy integration:',
    'any push to `main` triggers a Shopify deploy within minutes.',
    '',
    'Read `.bouldhq/notes/` for team knowledge (brand voice, prior decisions).',
    'Reference `.bouldhq/requests/request-<id>.md` for what you are handling.',
    'Use the creative files at the store root (`*.blend`, `*.glb`, design',
    'reference images) as read-only context — do not modify them.',
  ];
  await fs.writeFile(path.join(ephemeral, 'store-info.md'), lines.join('\n') + '\n', 'utf8');
}

async function writeRequestFile(root: string, ctx: PlaybookContext): Promise<string> {
  const dir = path.join(root, '.bouldhq', 'requests');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `request-${ctx.requestId}.md`);
  const triage = ctx.triageResult || {};
  const body = [
    `# Request ${ctx.requestId}`,
    '',
    `- **Category (triage)**: ${triage.category ?? '(unknown)'}`,
    `- **Triage suggestion**: ${triage.suggestedAction ?? '(none)'}`,
    `- **Triage reasoning**: ${triage.reasoning ?? '(none)'}`,
    '',
    '## Raw body',
    '',
    ctx.rawBody,
  ];
  await fs.writeFile(file, body.join('\n') + '\n', 'utf8');
  return file;
}

async function writeStoreNotes(root: string, tagId: number): Promise<number> {
  const dir = path.join(root, '.bouldhq', 'notes');
  await fs.mkdir(dir, { recursive: true });
  const subTagIds = (await prisma.tag.findMany({ where: { parent: tagId }, select: { id: true } })).map((t) => t.id);
  const allTagIds = [tagId, ...subTagIds];
  const notes = await prisma.notes.findMany({
    where: { isRecycle: false, tags: { some: { tagId: { in: allTagIds } } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: { account: { select: { name: true, nickname: true } } },
  });
  for (const n of notes) {
    const title = (n.content.split('\n')[0] ?? '').replace(/^#+\s*/, '').trim() || `note-${n.id}`;
    const file = path.join(dir, `${String(n.id).padStart(4, '0')}-${fileSlug(title)}.md`);
    const front = [
      '---',
      `note_id: ${n.id}`,
      `author: ${n.account?.nickname || n.account?.name || 'unknown'}`,
      `updated_at: ${n.updatedAt.toISOString()}`,
      '---',
      '',
    ].join('\n');
    await fs.writeFile(file, front + n.content + '\n', 'utf8');
  }
  return notes.length;
}

// Per-store constitution at the ROOT (not inside .bouldhq) so Claude Code's
// auto-discovery picks it up. Do NOT overwrite Brian's own CLAUDE.md if he
// already authored one — only seed when missing.
async function ensureStoreClaudeMd(root: string, ctx: PlaybookContext, themeDir: string | null): Promise<void> {
  const claudeMd = path.join(root, 'CLAUDE.md');
  try { await fs.access(claudeMd); return; } catch {}

  const themeRel = themeDir ? path.relative(root, themeDir) : 'theme_export__*/';
  const body = [
    `# ${ctx.storeName} — BouldHQ operations agent`,
    '',
    'You are the dedicated autonomous operations manager for this single Shopify',
    'store. Brian uses this folder to do all creative + theme work. You are an',
    'extension of him: when a request comes in, read it, decide what to do, and',
    'either ship a fix or hand back a structured brief for a human.',
    '',
    '## Where things live',
    '',
    `- **Theme code** (your edit target): \`${themeRel}\`` ,
    '  - Standard Shopify directory layout: `assets/`, `config/`, `layout/`,',
    '    `locales/`, `sections/`, `snippets/`, `templates/`.',
    '  - This is a **git checkout connected to Shopify via the GitHub deploy',
    '    integration**. `git push origin main` from inside this folder triggers',
    '    a live deploy within minutes. Read-only deploys do not exist —',
    '    only push when you intend to ship.',
    '- **Request you are handling**: `.bouldhq/requests/request-<id>.md`',
    '- **Team notes** (brand voice, prior decisions, owner preferences):',
    '  `.bouldhq/notes/` — newest first.',
    '- **Store identity**: `.bouldhq/store-info.md`',
    '- **Creative reference files** at the store root (`*.blend`, `*.glb`,',
    '  reference images, design files): READ-ONLY. Use as context for what',
    '  the store is trying to be. Never modify or commit these.',
    '',
    '## Shipping a theme fix — the canonical loop',
    '',
    '```bash',
    `cd ${themeRel}`,
    'git status                                # confirm what you might change',
    '# … use Edit/Write to make the change in templates/, sections/, etc.',
    'git diff                                  # double-check before committing',
    'git add -A',
    'git commit -m "Fix #<request-id>: <short description>"',
    'git push origin main                      # Shopify auto-deploys',
    '```',
    '',
    'Always include `#<request-id>` in the commit message so the change is',
    'traceable back to the request. Keep commit messages short and imperative.',
    '',
    '## Output contract — finish with `.bouldhq/result.json`',
    '',
    'Every run MUST end by writing this file in the store folder:',
    '',
    '```json',
    '{',
    '  "status": "auto_done" | "needs_assistance" | "blocked",',
    '  "summary": "one-sentence outcome",',
    '  "actions_taken": [',
    '    { "kind": "theme_pushed", "title": "Fix About page copy", "commit": "<sha>" },',
    '    { "kind": "note_created", "title": "Draft v1", "file": ".bouldhq/drafts/x.md" }',
    '  ],',
    '  "human_brief": null,',
    '  "questions_for_owner": []',
    '}',
    '```',
    '',
    '- `auto_done` — you shipped the fix. **Use this whenever you successfully',
    '  pushed a commit, even if you have follow-up items for the human.** Put',
    '  any follow-ups (clarifications, eyeball checks, optional improvements)',
    '  in `human_brief` — they will be surfaced alongside the auto_done status.',
    '  Shipping + follow-ups is the common case; do not downgrade to',
    '  needs_assistance just because you have notes for the human.',
    '- `needs_assistance` — you **could not ship the fix**. The work requires',
    '  human intervention before progress can be made (3D model, owner',
    '  decision, account access, fundamentally ambiguous spec). No commit',
    '  was made. Fill `human_brief` with a concrete tickable checklist.',
    '- `blocked` — technical failure only (no theme found, push rejected,',
    '  missing data). Don\'t use this for "I need help" — that is needs_assistance.',
    '',
    '**Decision table:**',
    '',
    '| Did you commit + push? | Are there follow-ups? | status         |',
    '| ---------------------- | --------------------- | -------------- |',
    '| Yes                    | No                    | auto_done      |',
    '| Yes                    | Yes                   | auto_done      |',
    '| No                     | Human needs to act    | needs_assistance |',
    '| No                     | Technical failure     | blocked        |',
    '',
    '## Policies',
    '',
    '- **Drafts go in `.bouldhq/drafts/`** — list them in `actions_taken` with',
    '  `kind: "note_created"` and `file` pointing at the draft. The runner',
    '  reads each draft and saves it as a team note tagged with this store.',
    '- **Never publish/push without a clear request mandate.** Drafting is',
    '  always safe; deploying is not.',
    '- **Read `.bouldhq/notes/` for brand voice before drafting copy.**',
    '- **Keep `human_brief.checklist` items concrete and tickable** (verb-led,',
    '  one action each).',
    '- **If the theme folder is missing**, set `status: "blocked"`, summary',
    '  "no theme_export__*/ found", and brief the human to pull the theme.',
  ];
  await fs.writeFile(claudeMd, body.join('\n') + '\n', 'utf8');
}

async function materializeWorkspace(root: string, ctx: PlaybookContext): Promise<{ steps: PlaybookStep[]; themeDir: string | null }> {
  const out: PlaybookStep[] = [];
  await resetEphemeral(root);
  const themeDir = await discoverThemeRepo(root);
  if (themeDir) out.push(step('ok', `Theme discovered: ${path.basename(themeDir)}`));
  else out.push(step('warn', `No theme_export__*/ folder under ${root} — agent will flag for human.`));
  await ensureStoreClaudeMd(root, ctx, themeDir);
  await writeStoreInfo(root, ctx, themeDir);
  await writeRequestFile(root, ctx);
  const noteCount = await writeStoreNotes(root, ctx.tagId);
  out.push(step('info', `Materialized ${noteCount} team notes into .bouldhq/notes/`));
  await fs.mkdir(path.join(root, '.bouldhq', 'drafts'), { recursive: true });
  return { steps: out, themeDir };
}

// ---------- claude_code playbook --------------------------------------------

function buildClaudePrompt(ctx: PlaybookContext, themeDir: string | null): string {
  const lines = [
    `You are handling request #${ctx.requestId} for store "${ctx.storeName}".`,
    `Read CLAUDE.md first. Then read .bouldhq/requests/request-${ctx.requestId}.md.`,
    '',
    'Reference .bouldhq/notes/ for team context (brand voice, prior decisions).',
  ];
  if (themeDir) {
    lines.push(
      '',
      `The theme code is at: ${path.basename(themeDir)}/`,
      'If the request is a theme change, make it there. Commit with message',
      `"Fix #${ctx.requestId}: <summary>" and push to origin main to deploy.`,
    );
  } else {
    lines.push(
      '',
      'No theme folder was found. If the request needs theme work, set',
      'status="blocked" and brief the human to pull the theme down first.',
    );
  }
  lines.push(
    '',
    'Finish by writing .bouldhq/result.json with the contract from CLAUDE.md.',
  );
  return lines.join('\n');
}

async function readResultJson(root: string): Promise<any | null> {
  const file = path.join(root, '.bouldhq', 'result.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function persistAgentActions(
  root: string,
  actions: AgentAction[],
  ctx: PlaybookContext,
  ownerAccountId: number,
): Promise<AgentAction[]> {
  const out: AgentAction[] = [];
  for (const action of actions) {
    if (action.kind !== 'note_created' || !action.file) { out.push(action); continue; }
    const filePath = path.resolve(root, action.file);
    if (!filePath.startsWith(root + path.sep)) {
      out.push({ ...action, preview: '[skipped: file outside store folder]' });
      continue;
    }
    let content: string;
    try { content = await fs.readFile(filePath, 'utf8'); }
    catch { out.push({ ...action, preview: '[skipped: file not found]' }); continue; }
    const stamped = `${content.trimEnd()}\n\n_— drafted by BouldHQ agent for request ${ctx.requestId}_\n`;
    const note = await prisma.notes.create({
      data: {
        accountId: ownerAccountId,
        content: stamped,
        type: 0,
        metadata: { bouldhqStoreId: ctx.tagId, bouldhqRequestId: ctx.requestId } as any,
      },
    });
    await prisma.tagsToNote.create({ data: { noteId: note.id, tagId: ctx.tagId } });
    out.push({ ...action, noteId: note.id, preview: stamped.slice(0, 240) });
  }
  return out;
}

async function pickAgentOwner(teamId: number): Promise<number | null> {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    orderBy: [{ role: 'asc' }, { accountId: 'asc' }],
    select: { accountId: true, role: true },
  });
  if (members.length === 0) return null;
  return (members.find((m) => m.role === 'founder') ?? members[0]).accountId;
}

const claudeCode: Playbook = async (ctx) => {
  const steps: PlaybookStep[] = [];
  const root = await storeRoot(ctx.storeName);
  const { steps: matSteps, themeDir } = await materializeWorkspace(root, ctx);
  steps.push(...matSteps);
  steps.push(step('info', `Spawning ${CLAUDE_BIN} in ${root}`));

  const prompt = buildClaudePrompt(ctx, themeDir);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn({
      cmd: [
        CLAUDE_BIN, '-p', prompt,
        '--output-format', 'json',
        '--allowedTools', CLAUDE_ALLOWED_TOOLS,
        '--permission-mode', 'acceptEdits',
      ],
      cwd: root,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        BOULDHQ_TAG_ID: String(ctx.tagId),
        BOULDHQ_TEAM_ID: String(ctx.teamId),
        BOULDHQ_REQUEST_ID: String(ctx.requestId),
        BOULDHQ_STORE_NAME: ctx.storeName,
      },
    }) as any;
  } catch (err: any) {
    steps.push(step('fail', `Could not spawn ${CLAUDE_BIN}: ${err?.message ?? err}.`));
    return { status: 'blocked', summary: 'spawn_failed', steps };
  }

  // Hard timeout — if the agent doesn't return in CLAUDE_TIMEOUT_MS we kill
  // it and fail the request rather than leaving it stuck in auto_running.
  let timedOut = false;
  const killer = setTimeout(() => { timedOut = true; try { proc.kill(); } catch {} }, CLAUDE_TIMEOUT_MS);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as any).text().catch(() => ''),
    new Response(proc.stderr as any).text().catch(() => ''),
    proc.exited,
  ]);
  clearTimeout(killer);

  if (timedOut) {
    steps.push(step('fail', `Claude Code timed out after ${Math.round(CLAUDE_TIMEOUT_MS / 1000)}s`));
    if (stderr) steps.push(step('warn', stderr.slice(0, 1000)));
    return { status: 'needs_assistance', summary: 'Agent timed out — review the partial run', steps };
  }
  if (exitCode !== 0) {
    steps.push(step('fail', `Claude Code exited with code ${exitCode}`));
    if (stderr) steps.push(step('fail', stderr.slice(0, 2000)));
    if (stdout) steps.push(step('info', stdout.slice(0, 2000)));
    return { status: 'needs_assistance', summary: `Agent exited with code ${exitCode}`, steps };
  }

  const result = await readResultJson(root);
  if (!result || typeof result !== 'object') {
    let report = stdout;
    try { const parsed = JSON.parse(stdout); if (typeof parsed?.result === 'string') report = parsed.result; } catch {}
    steps.push(step('warn', 'No .bouldhq/result.json from agent; using stdout as fallback.'));
    steps.push(step('info', report.slice(0, 4000)));
    return { status: 'needs_assistance', summary: 'Agent finished but did not emit a structured result', steps };
  }

  const validStatuses = ['auto_done', 'needs_assistance', 'blocked'] as const;
  type Status = typeof validStatuses[number];
  let status: Status = validStatuses.includes(result.status) ? result.status : 'needs_assistance';

  // Auto-correct over-cautious agents: if a theme commit was actually pushed,
  // the work shipped — regardless of whatever the agent labelled the result.
  // Follow-ups stay surfaced via human_brief, but the request closes.
  const rawActionsForCheck: any[] = Array.isArray(result.actions_taken) ? result.actions_taken : [];
  const shippedSomething = rawActionsForCheck.some((a) => a?.kind === 'theme_pushed');
  if (shippedSomething && status !== 'auto_done') {
    steps.push(step('info', `Auto-promoted status from "${status}" → "auto_done" because a theme commit was pushed.`));
    status = 'auto_done';
  }
  const summary: string = (typeof result.summary === 'string' && result.summary.trim())
    ? result.summary.trim()
    : 'Agent finished';
  const rawActions: AgentAction[] = rawActionsForCheck as AgentAction[];
  const brief: HumanBrief | undefined = result.human_brief && typeof result.human_brief === 'object'
    ? {
        title: String(result.human_brief.title ?? 'Manual work required'),
        checklist: Array.isArray(result.human_brief.checklist)
          ? result.human_brief.checklist.map((s: any) => String(s))
          : [],
        context_for_human: String(result.human_brief.context_for_human ?? ''),
      }
    : undefined;
  const questions: string[] = Array.isArray(result.questions_for_owner)
    ? result.questions_for_owner.map((s: any) => String(s))
    : [];

  const ownerId = await pickAgentOwner(ctx.teamId);
  let persistedActions: AgentAction[] = rawActions;
  if (ownerId !== null && rawActions.length > 0) {
    persistedActions = await persistAgentActions(root, rawActions, ctx, ownerId);
    const created = persistedActions.filter((a) => a.noteId).length;
    if (created > 0) steps.push(step('ok', `Persisted ${created} agent draft(s) as store notes.`));
  }

  // Surface theme commits in steps so the user can see they shipped.
  for (const a of persistedActions) {
    if (a.kind === 'theme_pushed') {
      steps.push(step('ok', `Theme deployed: ${a.title || 'change'}${a.commit ? ` (${a.commit.slice(0, 7)})` : ''}`));
    }
  }

  steps.push(step('ok', `Agent completed with status=${status}`));
  return {
    status,
    summary,
    steps,
    ...(brief && { brief }),
    ...(persistedActions.length > 0 && { actions: persistedActions }),
    ...(questions.length > 0 && { questions }),
  };
};

// ---------- Registry --------------------------------------------------------

const REGISTRY: Record<string, Playbook> = {
  dns_record_check: dnsRecordCheck,
  claude_code: claudeCode,
};
const FALLBACK_PLAYBOOK: Playbook = claudeCode;

// ---------- Entry point -----------------------------------------------------

export async function runPlaybook(requestId: number): Promise<void> {
  const req = await prisma.storeRequest.findUnique({ where: { id: requestId } });
  if (!req) { console.warn(`[playbook] request ${requestId} not found`); return; }
  if (req.status !== 'auto_running') {
    console.log(`[playbook] request ${requestId} is in status='${req.status}', skipping`);
    return;
  }

  const [profile, tag] = await Promise.all([
    prisma.storeProfile.findFirst({ where: { tagId: req.tagId } }),
    prisma.tag.findUnique({ where: { id: req.tagId }, select: { name: true } }),
  ]);

  const ctx: PlaybookContext = {
    requestId,
    tagId: req.tagId,
    teamId: req.teamId,
    rawBody: req.rawBody,
    triageResult: req.triageResult,
    storeUrl: profile?.storeUrl || null,
    storeName: tag?.name || `store-${req.tagId}`,
  };

  const category = (req.triageResult as any)?.category ?? 'unknown';
  const playbook = REGISTRY[category] ?? FALLBACK_PLAYBOOK;

  const startedAt = new Date().toISOString();
  let outcome: PlaybookOutcome;
  let runtimeError: string | undefined;
  try {
    outcome = await playbook(ctx);
  } catch (err: any) {
    runtimeError = err?.message ?? String(err);
    outcome = { status: 'blocked', summary: 'Playbook threw an error', steps: [step('fail', runtimeError)] };
  }
  const finishedAt = new Date().toISOString();

  // Map outcome.status → storeRequest.status. needs_assistance + blocked stay
  // open for human action; auto_done closes the request.
  const nextStatus =
    outcome.status === 'auto_done' ? 'auto_done'
    : 'needs_assistance';

  await prisma.storeRequest.update({
    where: { id: requestId },
    data: {
      status: nextStatus,
      runLog: {
        startedAt, finishedAt, category,
        status: outcome.status,
        summary: outcome.summary,
        steps: outcome.steps,
        ...(outcome.brief && { brief: outcome.brief }),
        ...(outcome.actions && { actions: outcome.actions }),
        ...(outcome.questions && { questions: outcome.questions }),
        ...(runtimeError ? { error: runtimeError } : {}),
      } as any,
      ...(outcome.status === 'auto_done' && { closedAt: new Date() }),
    },
  });
}
