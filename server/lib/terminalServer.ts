// BouldHQ Phase 4 — agent-manager terminal over WebSocket.
//
// One PTY-like subprocess per (account, store-tag). Auth gates: caller must be
// a 'manager' or 'founder' of the team that owns the tag.
//
// We deliberately use Bun.spawn with stdin/stdout pipes rather than node-pty:
// node-pty's native bindings fail to load under Bun (posix_spawnp failure).
// Consequence: TTY-mode apps (vim, less, htop) won't render correctly, but
// line-oriented work (`claude`, `bash`, `git`, `npm`, `shopify theme dev`) is fine.

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer, IncomingMessage } from 'http';
import { Subprocess } from 'bun';
import path from 'path';
import fs from 'fs/promises';
import { verifyToken } from './helper';
import { prisma } from '@server/prisma';

const WS_PATH = '/ws/terminal';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_MSG_BYTES = 64 * 1024;

const WORKDIR_ROOT = path.resolve(process.cwd(), '../.bouldhq-workdirs');

type Handshake = { token: string; tagId: number };

function isHandshake(x: unknown): x is Handshake {
  return !!x && typeof x === 'object'
    && typeof (x as any).token === 'string'
    && typeof (x as any).tagId === 'number';
}

async function ensureWorkdir(teamId: number, tagId: number): Promise<string> {
  const dir = path.join(WORKDIR_ROOT, `team-${teamId}`, `store-${tagId}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function authorize(token: string, tagId: number) {
  const user = await verifyToken(token);
  if (!user?.sub) return { ok: false as const, reason: 'invalid_token' as const };

  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    select: { id: true, name: true, teamId: true },
  });
  if (!tag?.teamId) return { ok: false as const, reason: 'tag_not_found' as const };

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_accountId: { teamId: tag.teamId, accountId: Number(user.sub) } },
  });
  if (!membership) return { ok: false as const, reason: 'not_team_member' as const };
  if (membership.role !== 'manager' && membership.role !== 'founder') {
    return { ok: false as const, reason: 'salesman_forbidden' as const };
  }
  return { ok: true as const, accountId: Number(user.sub), teamId: tag.teamId, tagName: tag.name };
}

function send(ws: WebSocket, type: string, payload: unknown = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...(payload as object) }));
}

async function handleSession(ws: WebSocket) {
  let child: Subprocess<'pipe', 'pipe', 'pipe'> | null = null;
  let stdoutDrain: Promise<void> | null = null;
  let stderrDrain: Promise<void> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let authed = false;

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(ws, 'info', { message: '[bouldhq] idle timeout — closing session' });
      try { child?.kill(); } catch {}
      ws.close(1000, 'idle');
    }, IDLE_TIMEOUT_MS);
  };

  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    try { child?.kill(); } catch {}
  };

  ws.on('close', cleanup);
  ws.on('error', (err) => { console.error('terminal ws error', err); cleanup(); });

  ws.on('message', async (raw, isBinary) => {
    if (isBinary || raw.length > MAX_MSG_BYTES) {
      send(ws, 'error', { reason: 'oversize_message' });
      ws.close(1009, 'oversize'); return;
    }
    resetIdle();

    let msg: any;
    try { msg = JSON.parse(raw.toString('utf8')); }
    catch { send(ws, 'error', { reason: 'bad_json' }); return; }

    if (!authed) {
      if (msg.type !== 'auth' || !isHandshake(msg)) {
        send(ws, 'error', { reason: 'expected_auth' });
        ws.close(1008, 'expected_auth'); return;
      }
      const auth = await authorize(msg.token, msg.tagId);
      if (!auth.ok) {
        send(ws, 'error', { reason: auth.reason });
        ws.close(1008, auth.reason); return;
      }

      const workdir = await ensureWorkdir(auth.teamId, msg.tagId);
      const shell = process.env.SHELL || '/bin/bash';

      try {
        child = Bun.spawn({
          cmd: [shell, '-i'],
          cwd: workdir,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            BOULDHQ_TAG: auth.tagName,
            BOULDHQ_TEAM_ID: String(auth.teamId),
            BOULDHQ_STORE_DIR: workdir,
            PS1: `\\[\\e[36m\\]bouldhq:${auth.tagName}\\[\\e[0m\\] $ `,
          },
        });
      } catch (err: any) {
        send(ws, 'error', { reason: 'spawn_failed', detail: err?.message });
        ws.close(1011, 'spawn_failed'); return;
      }

      authed = true;
      send(ws, 'ready', { workdir, tagName: auth.tagName });

      // Pipe child stdout/stderr → ws as plain UTF-8 data frames.
      const pipeStream = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (ws.readyState !== ws.OPEN) break;
          ws.send(JSON.stringify({ type: 'data', data: dec.decode(value, { stream: true }) }));
          resetIdle();
        }
      };
      stdoutDrain = pipeStream(child.stdout as any).catch(() => {});
      stderrDrain = pipeStream(child.stderr as any).catch(() => {});

      child.exited.then((code) => {
        send(ws, 'exit', { code });
        try { ws.close(1000, 'child_exit'); } catch {}
      });
      return;
    }

    // Post-auth message types.
    if (msg.type === 'input' && typeof msg.data === 'string' && child?.stdin) {
      try { (child.stdin as any).write(msg.data); }
      catch (err) { console.error('write stdin failed', err); }
    } else if (msg.type === 'ping') {
      send(ws, 'pong', { t: Date.now() });
    } else if (msg.type === 'resize') {
      // Real PTY resize would go here; pipe-mode child has no SIGWINCH. No-op.
    }
  });

  resetIdle();
}

export function attachTerminalServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => { handleSession(ws); });

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith(WS_PATH)) return; // let other handlers (e.g. Vite HMR) handle it
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  console.log(`📟 BouldHQ terminal WS listening on ${WS_PATH} (workdirs: ${WORKDIR_ROOT})`);
}
