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

// Escape a string for use inside an AppleScript "string literal".
function asEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Shopify CLI prefers the bare myshopify.com host. The stored URL might have
// a protocol and/or a trailing slash — normalize.
function normalizeShopifyStore(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

// Open iTerm with a two-pane layout already cd'd into themeDir.
//   Left pane (large):  cd <themeDir>; clear; claude
//   Right pane (small): cd <themeDir>; clear; shopify theme dev --store <url>
// storeUrl is optional — if absent, the --store flag is omitted and the
// shopify CLI will prompt for one.
// Falls back to Terminal.app if iTerm isn't installed.
export async function openInIterm(
  themeDir: string,
  storeName: string,
  storeUrl?: string,
): Promise<void> {
  await fs.access(themeDir).catch(() => {
    throw new Error(`Theme folder does not exist: ${themeDir}. Import the folder first.`);
  });

  const cdEsc = asEscape(themeDir);
  const normalizedStore = normalizeShopifyStore(storeUrl);
  const shopifyCmd = normalizedStore
    ? `shopify theme dev --store ${asEscape(normalizedStore)}`
    : `shopify theme dev`;

  // iTerm AppleScript notes:
  //   - Capture leftSession BEFORE splitting; `split vertically` shifts focus,
  //     so a later `current session` would point at the right pane.
  //   - Bind theWindow so we don't pick up a stale `current window` if the
  //     user already has other iTerm windows open.
  //   - Issue write text calls AFTER the split so each pane has its own PTY.
  const itermScript = `
tell application "iTerm"
  activate
  set theWindow to (create window with default profile)
  tell theWindow
    set leftSession to current session
    set rightSession to missing value
    tell leftSession
      set rightSession to (split vertically with default profile)
    end tell
    delay 0.25
    tell leftSession
      write text "cd \\"${cdEsc}\\" && clear && claude"
    end tell
    tell rightSession
      write text "cd \\"${cdEsc}\\" && clear && ${shopifyCmd}"
    end tell
  end tell
end tell
`.trim();

  const itermOk = await runOsa(itermScript).catch(() => false);
  if (itermOk) return;

  // Fallback: Terminal.app. We open TWO separate windows (not "in newWindow"
  // — that would route the second command into the first window's PTY, which
  // once `claude` starts becomes Claude's stdin, smushing both commands into
  // Claude's first user message).
  const terminalScript = `
tell application "Terminal"
  activate
  do script "cd \\"${cdEsc}\\" && clear && claude"
  delay 0.5
  do script "cd \\"${cdEsc}\\" && clear && ${shopifyCmd}"
end tell
`.trim();
  await runOsa(terminalScript);
}

// Open iTerm at the STORE ROOT (not the theme dir) with claude resuming the
// agent's most recent session for that store. Used for "Connect" on a specific
// request — manager picks up exactly where the autonomous agent left off, with
// all the materialized context in `.bouldhq/` still in place.
//
// Why store root, not theme dir: the agent ran with cwd = store root, so its
// session history + `.bouldhq/result.json` + `.bouldhq/requests/request-<id>.md`
// all live here. `claude --continue` from this folder picks them up. The
// manager can `cd` into the theme folder once they're in claude.
export async function openRequestInIterm(
  storeName: string,
  requestId: number,
): Promise<void> {
  const workdir = workdirFor(storeName);
  await fs.access(workdir).catch(() => {
    throw new Error(`Store workdir does not exist: ${workdir}. Create the store first.`);
  });

  const cdEsc = asEscape(workdir);
  const banner = `echo '— Picking up BouldHQ request #${requestId} for ${storeName} —'`;
  // claude --continue resumes the most recent session in cwd. The agent's
  // last `claude -p` run is what we want to land on.
  const claudeCmd = `${banner} && claude --continue`;

  const itermScript = `
tell application "iTerm"
  activate
  set theWindow to (create window with default profile)
  tell theWindow
    tell current session
      write text "cd \\"${cdEsc}\\" && clear && ${claudeCmd}"
    end tell
  end tell
end tell
`.trim();

  const itermOk = await runOsa(itermScript).catch(() => false);
  if (itermOk) return;

  const terminalScript = `
tell application "Terminal"
  activate
  do script "cd \\"${cdEsc}\\" && clear && ${claudeCmd}"
end tell
`.trim();
  await runOsa(terminalScript);
}

function runOsa(script: string): Promise<true> {
  return new Promise((resolve, reject) => {
    const proc = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (b) => { stderr += b.toString(); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) return resolve(true);
      reject(new Error(`osascript failed (${code}): ${stderr.trim() || 'no stderr'}`));
    });
  });
}
