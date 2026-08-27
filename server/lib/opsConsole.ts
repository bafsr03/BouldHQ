// BouldHQ Phase 9 — Ops Console helpers.
//
// Two operations: (1) import a folder from anywhere on the manager's disk into
// the centralized workdir; (2) launch iTerm with two panes (claude + theme dev)
// already cd'd into the store's theme folder.
//
// All paths are absolute and validated. Shell commands use spawn with arg
// arrays (never exec + shell string) so store names/paths can't inject.

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

const HOME = os.homedir();
export const WORKDIRS_ROOT = path.join(HOME, '.bouldhq-workdirs');

// Sluggify a store name. Lowercased, alphanum + dot + dash. Multi-segment names
// like "JCK.Approved" survive ("jck.approved"); spaces become dashes.
export function storeSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.\-]/g, '');
}

export function workdirFor(storeName: string): string {
  const slug = storeSlug(storeName);
  if (!slug) throw new Error('Invalid store name');
  return path.join(WORKDIRS_ROOT, slug);
}

// Resolve the theme directory for a store. Resolution order:
//   1. localThemePath (if set + non-empty + actually exists on disk)
//   2. Newest theme_export__* subfolder of the workdir (Shopify's exported
//      theme convention — that's what's inside each ~/Desktop/<store>/)
//   3. The workdir itself
//
// Returns { themeDir, source } so the UI can show how it was picked.
export async function themeDirFor(
  storeName: string,
  localThemePath: string,
): Promise<{ themeDir: string; source: 'explicit' | 'theme_export' | 'workdir' | 'missing' }> {
  const wd = workdirFor(storeName);
  const wdExists = !!(await fs.stat(wd).catch(() => null));
  if (!wdExists) return { themeDir: wd, source: 'missing' };

  // 1. Explicit override wins, if it actually exists.
  const sub = (localThemePath || '').trim();
  if (sub && sub !== '.' && sub !== './' && sub !== 'theme') {
    const resolved = path.resolve(wd, sub);
    if (!resolved.startsWith(wd + path.sep) && resolved !== wd) {
      throw new Error('themePath escapes the store workdir');
    }
    if (await fs.stat(resolved).catch(() => null)) {
      return { themeDir: resolved, source: 'explicit' };
    }
  }

  // 2. Newest theme_export__* directory by mtime.
  const entries = await fs.readdir(wd, { withFileTypes: true }).catch(() => []);
  const exports_ = entries.filter((e) => e.isDirectory() && e.name.startsWith('theme_export__'));
  if (exports_.length > 0) {
    const stats = await Promise.all(
      exports_.map(async (e) => {
        const full = path.join(wd, e.name);
        const st = await fs.stat(full).catch(() => null);
        return { full, mtime: st?.mtimeMs ?? 0 };
      }),
    );
    stats.sort((a, b) => b.mtime - a.mtime);
    return { themeDir: stats[0].full, source: 'theme_export' };
  }

  // 3. Workdir root.
  return { themeDir: wd, source: 'workdir' };
}

// Expand ~/ → user's home. path.resolve treats ~ as a literal character; users
// pasting `~/Desktop/X` would otherwise get joined with the server's cwd.
function expandTilde(p: string): string {
  const t = p.trim();
  if (t === '~') return HOME;
  if (t.startsWith('~/') || t.startsWith('~\\')) return path.join(HOME, t.slice(2));
  return t;
}

// rsync source → workdir. -a preserves perms/timestamps. NO --delete so a
// re-import won't wipe local changes that aren't in source. Source must be a
// directory the user owns. We don't restrict to ~/Desktop — but we DO refuse
// system paths and require the source exist + be a directory.
export async function importFolderIntoWorkdir(
  sourcePath: string,
  storeName: string,
): Promise<{ workdir: string; bytesCopied: number | null }> {
  const abs = path.resolve(expandTilde(sourcePath));
  if (!abs.startsWith(HOME + path.sep) && abs !== HOME) {
    throw new Error(`Source folder must be inside your home directory (got: ${abs})`);
  }
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Source path does not exist or is not a directory: ${abs}`);
  }

  const workdir = workdirFor(storeName);
  await fs.mkdir(workdir, { recursive: true });

  // rsync -a <src>/ <dst>/   (trailing slash on src means "contents of src").
  // Avoid `--info=stats2` — macOS ships an older rsync (2.6.9 → 3.x via brew)
  // that doesn't have it. We don't need the byte count badly enough to fight it.
  return new Promise((resolve, reject) => {
    const args = ['-a', `${abs}${path.sep}`, `${workdir}${path.sep}`];
    const proc = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (b) => { stderr += b.toString(); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`rsync failed (${code}): ${stderr.trim() || 'unknown'}`));
      resolve({ workdir, bytesCopied: null });
    });
  });
}

// Shopify CLI prefers the bare myshopify.com host. The stored URL might have
// a protocol and/or a trailing slash — normalize.
function normalizeShopifyStore(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

// The Shopify theme-export folder name reliably encodes the REAL myshopify
// handle, which the store profile's URL often doesn't (it may be a custom
// domain or a stale handle). Shopify's exporter names folders like
//   theme_export__<subdomain-with-dashes>-myshopify-com-<themeName>__<date>
// e.g. theme_export__j1wxtd-1w-myshopify-com-horizon__24JUN2026-0439pm
//      → j1wxtd-1w.myshopify.com
// The subdomain itself can contain literal dashes (j1wxtd-1w, joon-distribution),
// so we only collapse the fixed "-myshopify-com" marker back to ".myshopify.com".
export function shopifyHandleFromThemeExport(themeDir: string): string | null {
  const base = path.basename(themeDir);
  const m = base.match(/^theme_export__(.+?)-myshopify-com[-_]/i);
  return m ? `${m[1]}.myshopify.com` : null;
}

// The store to pass to `shopify theme dev --store`. Prefer the handle encoded
// in the theme_export folder name (ground truth for what was pulled), then the
// profile URL, then nothing (CLI will prompt).
export function resolveShopifyStore(themeDir: string, storeUrl?: string): string {
  return shopifyHandleFromThemeExport(themeDir) || normalizeShopifyStore(storeUrl) || '';
}

// Write a `.vscode/tasks.json` (+ a settings.json nudge) into `folder` so that
// opening it in a VS Code-family IDE (Antigravity) auto-launches each command
// in its own integrated terminal. Antigravity has no CLI to run terminal
// commands, so run-on-folderOpen tasks are the only automatic mechanism.
//
// NOTE: this file lands inside the theme's git checkout as an untracked file —
// acceptable. We overwrite our managed tasks wholesale (we own this file's
// purpose in the ops workflow). The first open of each folder still shows
// Antigravity's Workspace-Trust + "Allow Automatic Tasks" prompts (security
// gates that can't be bypassed programmatically); after allowing once it's
// smooth.
async function writeAutoRunTasks(
  folder: string,
  tasks: { label: string; command: string; background?: boolean }[],
): Promise<void> {
  const vscodeDir = path.join(folder, '.vscode');
  await fs.mkdir(vscodeDir, { recursive: true });

  const tasksJson = {
    version: '2.0.0',
    tasks: tasks.map((t) => ({
      label: t.label,
      type: 'shell',
      command: t.command,
      isBackground: !!t.background,
      options: { cwd: '${workspaceFolder}' },
      presentation: {
        panel: 'dedicated',
        group: 'opsconsole',
        reveal: 'always',
        focus: false,
        echo: true,
        clear: true,
      },
      runOptions: { runOn: 'folderOpen' },
      problemMatcher: [],
    })),
  };
  await fs.writeFile(path.join(vscodeDir, 'tasks.json'), JSON.stringify(tasksJson, null, 2) + '\n', 'utf8');

  // Best-effort: don't clobber an existing settings.json — merge the one key.
  const settingsPath = path.join(vscodeDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    if (typeof settings !== 'object' || settings === null) settings = {};
  } catch { /* no existing settings */ }
  settings['task.allowAutomaticTasks'] = 'on';
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// Open a folder as a workspace in Antigravity. Antigravity ships no folder-open
// CLI on PATH, so we go through macOS `open -a`. Try the newer "Antigravity IDE"
// bundle first, fall back to "Antigravity".
async function openFolderInAntigravity(folder: string): Promise<void> {
  const tryOpen = (appName: string): Promise<boolean> =>
    new Promise((resolve) => {
      const proc = spawn('open', ['-a', appName, folder], { stdio: ['ignore', 'ignore', 'pipe'] });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });

  if (await tryOpen('Antigravity IDE')) return;
  if (await tryOpen('Antigravity')) return;
  throw new Error('Could not launch Antigravity IDE. Is it installed in /Applications?');
}

// Open the store's theme folder in Antigravity IDE with two integrated
// terminals auto-started:
//   - shopify theme dev --store <handle>   (the store preview server)
//   - claude                                (the agent, cwd = theme folder)
// The `--store` handle is resolved from the theme_export folder name (ground
// truth) with the profile URL as a fallback — see resolveShopifyStore. If we
// can't determine a store, the flag is omitted and the CLI prompts.
export async function openInAntigravity(
  themeDir: string,
  storeName: string,
  storeUrl?: string,
  devServerPort?: number,
): Promise<void> {
  await fs.access(themeDir).catch(() => {
    throw new Error(`Theme folder does not exist: ${themeDir}. Import the folder first.`);
  });

  const store = resolveShopifyStore(themeDir, storeUrl);
  let dev = 'shopify theme dev';
  if (store) dev += ` --store ${store}`;
  if (devServerPort) dev += ` --port ${devServerPort}`;

  await writeAutoRunTasks(themeDir, [
    { label: 'Shopify theme dev', command: dev, background: true },
    { label: 'Claude', command: 'claude' },
  ]);
  await openFolderInAntigravity(themeDir);
}

// Open Antigravity IDE at the STORE ROOT (not the theme dir) with claude
// resuming the agent's most recent session for that store. Used for "Connect"
// on a specific request — manager picks up exactly where the autonomous agent
// left off, with all the materialized context in `.bouldhq/` still in place.
//
// Why store root, not theme dir: the agent ran with cwd = store root, so its
// session history + `.bouldhq/result.json` + `.bouldhq/requests/request-<id>.md`
// all live here. `claude --continue` from this folder picks them up.
export async function openRequestInAntigravity(
  storeName: string,
  requestId: number,
): Promise<void> {
  const workdir = workdirFor(storeName);
  await fs.access(workdir).catch(() => {
    throw new Error(`Store workdir does not exist: ${workdir}. Create the store first.`);
  });

  // claude --continue resumes the most recent session in cwd. The agent's
  // last `claude -p` run is what we want to land on.
  const claudeCmd =
    `echo '— Picking up BouldHQ request #${requestId} for ${storeName} —' && claude --continue`;

  await writeAutoRunTasks(workdir, [{ label: `Claude (request #${requestId})`, command: claudeCmd }]);
  await openFolderInAntigravity(workdir);
}
