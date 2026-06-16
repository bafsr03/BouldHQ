import { useEffect, useRef, useState } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Button, Chip } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import '@xterm/xterm/css/xterm.css';

// BouldHQ Phase 4 — agent-manager terminal.
// One PTY-like subprocess per (account, tagId) hosted on the backend.
// See server/lib/terminalServer.ts for the WS protocol.

type Status = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export function StoreTerminal({ tagId, tagName }: { tagId: number; tagName: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const connect = () => {
    if (status === 'connecting' || status === 'connected') return;
    const token = RootStore.Get(UserStore).tokenData.value?.token;
    if (!token) { setStatus('error'); setErrorMsg('No auth token'); return; }

    setStatus('connecting');
    setErrorMsg(null);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/terminal`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token, tagId }));
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const term = termRef.current;
      if (!term) return;
      if (msg.type === 'ready') {
        setStatus('connected');
        term.write(`\r\n\x1b[32m[bouldhq]\x1b[0m connected to store #${msg.tagName} — workdir: ${msg.workdir}\r\n`);
      } else if (msg.type === 'data' && typeof msg.data === 'string') {
        term.write(msg.data);
      } else if (msg.type === 'info' && typeof msg.message === 'string') {
        term.write(`\r\n\x1b[33m${msg.message}\x1b[0m\r\n`);
      } else if (msg.type === 'error') {
        setStatus('error');
        setErrorMsg(msg.reason || 'unknown error');
        term.write(`\r\n\x1b[31m[bouldhq] error: ${msg.reason}\x1b[0m\r\n`);
      } else if (msg.type === 'exit') {
        term.write(`\r\n\x1b[90m[bouldhq] shell exited (code ${msg.code})\x1b[0m\r\n`);
      }
    };

    ws.onerror = () => { setStatus('error'); setErrorMsg('WebSocket error'); };
    ws.onclose = () => {
      if (status !== 'error') setStatus('closed');
      wsRef.current = null;
    };
  };

  const disconnect = () => {
    try { wsRef.current?.close(1000, 'user_close'); } catch {}
    wsRef.current = null;
  };

  // Init xterm once when host is mounted.
  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = new Xterm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#4ade80',
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    termRef.current = term;
    fitRef.current = fit;
    term.write(`\x1b[90m[bouldhq] click "Connect" to open a shell scoped to this store.\x1b[0m\r\n`);

    const onResize = () => { try { fit.fit(); } catch {} };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      try { wsRef.current?.close(); } catch {}
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  const statusChip = (() => {
    switch (status) {
      case 'idle':       return <Chip size="sm" variant="flat" color="default">idle</Chip>;
      case 'connecting': return <Chip size="sm" variant="flat" color="warning">connecting…</Chip>;
      case 'connected':  return <Chip size="sm" variant="flat" color="success">connected</Chip>;
      case 'closed':     return <Chip size="sm" variant="flat" color="default">closed</Chip>;
      case 'error':      return <Chip size="sm" variant="flat" color="danger">{errorMsg || 'error'}</Chip>;
    }
  })();

  return (
    <section aria-label="Ops console" className="rounded-xl border border-divider bg-content1">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-divider">
        <div className="flex items-center gap-2 mr-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Ops console</h2>
          {statusChip}
        </div>
        <span className="text-xs text-default-500 hidden md:inline">
          Manager-only · scoped to <code className="font-mono">store-{tagId}</code>
        </span>
        {status === 'connected' ? (
          <Button size="sm" variant="flat" color="danger" onPress={disconnect}
            startContent={<Icon icon="tabler:plug-connected-x" width={14} height={14} />}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" color="primary" variant="flat" onPress={connect}
            isLoading={status === 'connecting'}
            startContent={status !== 'connecting' && <Icon icon="tabler:plug-connected" width={14} height={14} />}>
            Connect
          </Button>
        )}
      </header>
      <div className="px-3 py-3 bg-[#0a0a0a]">
        <div ref={hostRef} className="h-[420px] w-full overflow-hidden" />
      </div>
      <footer className="px-4 py-2 border-t border-divider text-xs text-default-500">
        Line-oriented IO only (no full PTY): <code className="font-mono">claude</code>, <code className="font-mono">bash</code>, <code className="font-mono">git</code>, <code className="font-mono">npm</code> work; TUI apps (vim, less) won't render correctly.
      </footer>
    </section>
  );
}
