import { observer } from 'mobx-react-lite';
import { useRef, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button, Chip, Popover, PopoverContent, PopoverTrigger, Textarea, Tooltip } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { ScrollArea } from '@/components/Common/ScrollArea';
import { api, streamApi } from '@/lib/trpc';

// /ai — BouldHQ assistant. Persists conversations via api.ai.assistantChat
// (kind='assistant' in message metadata). Recent-chats popover lets the user
// browse / resume / delete past chats.

type Turn =
  | { kind: 'user'; text: string; images?: string[] }
  | { kind: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { kind: 'permission'; requestId: string; tool: string; args: any; decided?: 'allow' | 'deny' }
  | { kind: 'error'; text: string };

type ToolCall = { tool: string; args?: any };

// Claude-Code-style modes. Shift+Tab cycles them; the footer shows the active
// one with a colour. The mode is sent with each turn (server gates tools
// accordingly): normal asks before writes, auto-accept runs freely, plan is
// read-only.
type AssistantMode = 'normal' | 'acceptEdits' | 'plan';
const MODE_ORDER: AssistantMode[] = ['normal', 'acceptEdits', 'plan'];
const MODE_META: Record<AssistantMode, { label: string; icon: string; hint: string; color: 'default' | 'warning' | 'primary'; dot: string }> = {
  normal:      { label: 'Normal',      icon: 'tabler:player-play',         hint: 'confirms before changes',  color: 'default', dot: 'bg-default-400' },
  acceptEdits: { label: 'Auto-accept', icon: 'tabler:player-track-next',   hint: 'runs tools without asking', color: 'warning', dot: 'bg-warning' },
  plan:        { label: 'Plan mode',   icon: 'tabler:player-pause',        hint: 'read-only · proposes a plan', color: 'primary', dot: 'bg-primary' },
};

type PendingImage = { id: string; dataUrl: string; mimeType: string };

type HistoryRow = {
  id: number;
  title: string;
  updatedAt: string | Date;
  messageCount: number;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
const MAX_PENDING_IMAGES = 6;

const EXAMPLES: { icon: string; title: string; prompt: string }[] = [
  {
    icon: 'tabler:search',
    title: 'Find a resource',
    prompt: 'Find the SOP for onboarding a new Shopify store.',
  },
  {
    icon: 'tabler:bulb',
    title: 'Where did I save…',
    prompt: 'Where did I save the brand colors for our latest client? Search my notes.',
  },
  {
    icon: 'tabler:flame',
    title: 'Open a task for the manager',
    prompt: 'Open a task: the owner of <store> emailed asking us to swap the homepage hero image. Their email said: ',
  },
];

const TOOL_LABEL: Record<string, { icon: string; label: string }> = {
  'bouldhq-find-resource':           { icon: 'tabler:folder-search',  label: 'searched resources' },
  'bouldhq-list-folders':            { icon: 'tabler:folders',        label: 'listed folders' },
  'bouldhq-list-stores':             { icon: 'tabler:building-store', label: 'listed stores' },
  'bouldhq-create-task-for-manager': { icon: 'tabler:flame',          label: 'opened request' },
  'bouldhq-create-resource-file':    { icon: 'tabler:file-plus',      label: 'created resource file' },
  'bouldhq-delete-resource':         { icon: 'tabler:trash',          label: 'deleted resource' },
  'bouldhq-move-resource':           { icon: 'tabler:arrows-move',    label: 'moved resource' },
  'bouldhq-rename-resource':         { icon: 'tabler:edit',           label: 'renamed resource' },
  'search-blinko-tool':              { icon: 'tabler:notes',          label: 'searched notes' },
};

// Pull the most human-relevant field out of a tool's args for the approval
// card (e.g. the file name or path the assistant is about to touch).
function permissionDetail(args: any): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, any>;
  const v = a.fileName ?? a.name ?? a.path ?? a.newPath ?? a.title ?? a.storeName ?? a.content;
  if (typeof v !== 'string') return '';
  return v.length > 160 ? v.slice(0, 157) + '…' : v;
}

// Present-tense phrasing for the approval card (the TOOL_LABEL map is
// past-tense, which reads wrong in a "Allow the assistant to …?" prompt).
const WRITE_ACTION_LABEL: Record<string, string> = {
  'bouldhq-create-resource-file':    'create a resource file',
  'bouldhq-delete-resource':         'delete a resource',
  'bouldhq-move-resource':           'move a resource',
  'bouldhq-rename-resource':         'rename a resource',
  'bouldhq-create-task-for-manager': 'open a task for the manager',
};

function formatRelative(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

const AssistantPage = observer(() => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ccConfigured, setCcConfigured] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<AssistantMode>('normal');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    api.ai.claudeCodeStatus
      .query()
      .then((s) => setCcConfigured(s.configured))
      .catch(() => setCcConfigured(false));
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const rows = await api.ai.listAssistantConversations.query({ page: 1, size: 30 });
      setHistory(rows as any);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const newChat = () => {
    setTurns([]);
    setConversationId(null);
    setInput('');
    setPendingImages([]);
  };

  // ---- Image attachment helpers --------------------------------------------

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (incoming.length === 0) return;
    const accepted: PendingImage[] = [];
    for (const file of incoming) {
      if (file.size > MAX_IMAGE_BYTES) {
        setTurns((prev) => [...prev, { kind: 'error', text: `"${file.name}" is over 5MB — skipping.` }]);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        accepted.push({
          id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl,
          mimeType: file.type || 'image/png',
        });
      } catch {
        setTurns((prev) => [...prev, { kind: 'error', text: `Couldn't read "${file.name}".` }]);
      }
    }
    setPendingImages((prev) => {
      const next = [...prev, ...accepted];
      return next.slice(0, MAX_PENDING_IMAGES);
    });
  }, []);

  const removePendingImage = (id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id));
  };

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addImageFiles(files);
      }
    },
    [addImageFiles],
  );

  const loadConversation = async (id: number) => {
    setHistoryOpen(false);
    setBusy(true);
    try {
      const conv = await api.ai.getAssistantConversation.query({ id });
      const loaded: Turn[] = conv.messages.map((m: any) =>
        m.role === 'user'
          ? ({ kind: 'user', text: m.content } as Turn)
          : ({ kind: 'assistant', text: m.content, toolCalls: m.toolCalls ?? [] } as Turn),
      );
      setTurns(loaded);
      setConversationId(conv.id);
    } catch (e: any) {
      setTurns([{ kind: 'error', text: e?.message ?? 'Failed to load conversation' }]);
    } finally {
      setBusy(false);
    }
  };

  const deleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.ai.deleteAssistantConversation.mutate({ id });
      setHistory((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) newChat();
    } catch {
      /* swallow — keep UI responsive */
    }
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    const hasImages = pendingImages.length > 0;
    if ((!msg && !hasImages) || busy) return;
    if (ccConfigured === false) {
      setTurns((prev) => [
        ...prev,
        { kind: 'user', text: msg || '(image)' },
        {
          kind: 'error',
          text: "AI isn't connected yet. Ask the owner to run `claude setup-token` on the server and set CLAUDE_CODE_OAUTH_TOKEN.",
        },
      ]);
      setInput('');
      setPendingImages([]);
      return;
    }
    setBusy(true);

    const history = turns.flatMap((t): { role: 'user' | 'assistant'; content: string }[] => {
      if (t.kind === 'user')      return [{ role: 'user', content: t.text }];
      if (t.kind === 'assistant') return [{ role: 'assistant', content: t.text }];
      return [];
    });

    const imagesForApi = pendingImages.map((p) => ({ dataUrl: p.dataUrl, mimeType: p.mimeType }));
    const userTurn: Turn = {
      kind: 'user',
      text: msg || (hasImages ? `(${pendingImages.length} image${pendingImages.length === 1 ? '' : 's'})` : ''),
      images: hasImages ? pendingImages.map((p) => p.dataUrl) : undefined,
    };
    setTurns((prev) => [...prev, userTurn]);
    setInput('');
    setPendingImages([]);

    // Lazily grow the assistant bubble: append to the last assistant turn, or
    // start a new one. This keeps text that resumes AFTER an approval card
    // landing below the card instead of jumping back up into the old bubble.
    const appendAssistantText = (text: string) =>
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.kind === 'assistant') next[next.length - 1] = { ...last, text: last.text + text };
        else next.push({ kind: 'assistant', text, toolCalls: [] });
        return next;
      });
    const addAssistantTool = (tool: string, args: any) =>
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.kind === 'assistant') next[next.length - 1] = { ...last, toolCalls: [...last.toolCalls, { tool, args }] };
        else next.push({ kind: 'assistant', text: '', toolCalls: [{ tool, args }] });
        return next;
      });
    const showError = (text: string) => setTurns((prev) => [...prev, { kind: 'error', text }]);

    try {
      const stream = await streamApi.ai.assistantChatStream.mutate({
        message: msg || 'Please review the attached image(s) and tell me what you see.',
        history,
        conversationId: conversationId ?? undefined,
        images: imagesForApi,
        mode,
      });

      let produced = false;
      for await (const chunk of stream) {
        if (chunk.type === 'delta') {
          produced = true;
          appendAssistantText(chunk.text);
        } else if (chunk.type === 'tool') {
          produced = true;
          addAssistantTool(chunk.tool, chunk.args);
        } else if (chunk.type === 'permission') {
          produced = true;
          setTurns((prev) => [...prev, { kind: 'permission', requestId: chunk.requestId, tool: chunk.tool, args: chunk.args }]);
        } else if (chunk.type === 'error') {
          produced = true;
          showError(chunk.error || 'Assistant error');
        } else if (chunk.type === 'done') {
          if (chunk.conversationId && chunk.conversationId !== conversationId) {
            setConversationId(chunk.conversationId);
          }
          refreshHistory();
        }
      }

      if (!produced) appendAssistantText('(no response)');
    } catch (e: any) {
      showError(e?.message ?? 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  // Cycle Normal → Auto-accept → Plan → Normal (Shift+Tab, like Claude Code).
  const cycleMode = () =>
    setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]);

  // Answer a Normal-mode approval prompt; unblocks the parked server stream.
  const respondPermission = async (requestId: string, allow: boolean) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.kind === 'permission' && t.requestId === requestId ? { ...t, decided: allow ? 'allow' : 'deny' } : t,
      ),
    );
    try {
      await api.ai.respondToToolPermission.mutate({ requestId, allow });
    } catch {
      /* stream will time out and deny server-side if this fails */
    }
  };

  const isEmpty = turns.length === 0;
  const hasMessages = turns.length > 0;

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="border-b border-divider px-4 md:px-8 py-4 flex items-center gap-3">
        <Icon icon="tabler:sparkles" width={20} height={20} className="text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold">BouldHQ Assistant</h1>
          <p className="text-xs text-default-500 truncate">
            Ask about the app · find a resource you saved · open a task for the agent manager.
          </p>
        </div>

        <Tooltip content="Start a new chat" placement="bottom">
          <Button
            size="sm"
            variant="flat"
            isIconOnly
            onPress={newChat}
            isDisabled={isEmpty && !conversationId}
            aria-label="New chat"
          >
            <Icon icon="tabler:plus" width={16} height={16} />
          </Button>
        </Tooltip>

        <Popover
          placement="bottom-end"
          isOpen={historyOpen}
          onOpenChange={(open) => {
            setHistoryOpen(open);
            if (open) refreshHistory();
          }}
        >
          <PopoverTrigger>
            <Button
              size="sm"
              variant="flat"
              startContent={<Icon icon="tabler:history" width={14} height={14} />}
              aria-label="Recent chats"
            >
              History
              {history.length > 0 && (
                <span className="ml-1 text-[10px] text-default-500">{history.length}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[340px] max-w-[90vw]">
            <div className="border-b border-divider px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-default-600">Recent chats</span>
              <Button
                size="sm"
                variant="light"
                onPress={() => { newChat(); setHistoryOpen(false); }}
                startContent={<Icon icon="tabler:plus" width={12} height={12} />}
                className="h-7 min-w-0 px-2"
              >
                New
              </Button>
            </div>
            <div className="max-h-[400px] overflow-y-auto py-1">
              {historyLoading && (
                <div className="px-3 py-4 text-xs text-default-500 flex items-center gap-2">
                  <Icon icon="tabler:loader-2" width={12} height={12} className="animate-spin" />
                  loading…
                </div>
              )}
              {!historyLoading && history.length === 0 && (
                <div className="px-3 py-6 text-xs text-default-500 text-center">
                  No chats yet. Start one below.
                </div>
              )}
              {!historyLoading && history.map((row) => {
                const active = row.id === conversationId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => loadConversation(row.id)}
                    className={
                      'group w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-default-100 transition-colors ' +
                      (active ? 'bg-primary/5' : '')
                    }
                  >
                    <Icon
                      icon={active ? 'tabler:message-2-check' : 'tabler:message-2'}
                      width={14}
                      height={14}
                      className={active ? 'text-primary mt-0.5' : 'text-default-400 mt-0.5'}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{row.title}</div>
                      <div className="text-[11px] text-default-500">
                        {formatRelative(row.updatedAt)} · {row.messageCount} message{row.messageCount === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => deleteConversation(row.id, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteConversation(row.id, e as any);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-danger/10 text-default-400 hover:text-danger"
                      aria-label={`Delete chat "${row.title}"`}
                    >
                      <Icon icon="tabler:trash" width={14} height={14} />
                    </span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {ccConfigured === false && (
          <Chip size="sm" variant="flat" color="warning" startContent={<Icon icon="tabler:plug-off" width={12} height={12} />}>
            AI not connected
          </Chip>
        )}
        {ccConfigured === true && (
          <Chip size="sm" variant="flat" color="success" startContent={<Icon icon="tabler:plug-connected" width={12} height={12} />}>
            Claude Code
          </Chip>
        )}
      </header>

      <ScrollArea fixMobileTopBar className="flex-1">
        <div ref={scrollRef} className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-4">
          {isEmpty && (
            <section className="space-y-4">
              <div className="rounded-xl border border-divider bg-content1 p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600 mb-2">
                  What this assistant can do
                </h2>
                <ul className="text-sm text-default-700 space-y-1.5 list-disc list-inside">
                  <li>Explain how BouldHQ works — pages, roles, the request flow, the ops console.</li>
                  <li>Find a saved file under Resources (SOPs, Onboarding Templates, Branding Assets…).</li>
                  <li>Find a note you can't remember where you put using semantic search.</li>
                  <li>Open a request against a store for the agent manager to triage.</li>
                  <li>Generate a brand-aware HTML report or any document and save it into Resources.</li>
                </ul>
                <p className="text-xs text-default-500 mt-3">
                  Personal notes &amp; team store data are kept separate.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.title}
                    type="button"
                    onClick={() => send(ex.prompt)}
                    className="text-left rounded-xl border border-divider bg-content1 p-4 hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <Icon icon={ex.icon} width={18} height={18} className="text-primary mb-1.5" />
                    <div className="font-medium text-sm">{ex.title}</div>
                    <div className="text-xs text-default-500 mt-1 line-clamp-2">{ex.prompt}</div>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-divider bg-default-50 p-4 text-xs text-default-500 space-y-1.5">
                <div>
                  Tip: type <code className="font-mono">/help</code> to see slash commands, or{' '}
                  <code className="font-mono">/report &lt;store&gt;</code> to generate a brand-aware HTML report and save it under Branding Assets.
                </div>
                <div>
                  Tasks you open land straight in that store's <Link to="/stores" className="underline">Requests panel</Link> for triage.
                </div>
              </div>
            </section>
          )}

          {turns.map((t, i) => {
            if (t.kind === 'user') {
              return (
                <article key={i} className="flex justify-end">
                  <div className="flex flex-col items-end gap-1.5 max-w-[85%]">
                    {t.images && t.images.length > 0 && (
                      <div className={`grid gap-1.5 ${t.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        {t.images.map((src, j) => (
                          <img
                            key={j}
                            src={src}
                            alt={`attachment ${j + 1}`}
                            className="rounded-lg max-h-56 object-cover border border-divider"
                          />
                        ))}
                      </div>
                    )}
                    {t.text && (
                      <div className="rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap break-words">
                        {t.text}
                      </div>
                    )}
                  </div>
                </article>
              );
            }
            if (t.kind === 'error') {
              return (
                <article key={i} className="rounded-md bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">
                  {t.text}
                </article>
              );
            }
            if (t.kind === 'permission') {
              const action = WRITE_ACTION_LABEL[t.tool] ?? (TOOL_LABEL[t.tool]?.label ?? t.tool);
              const detail = permissionDetail(t.args);
              const decided = t.decided;
              return (
                <article key={i} className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 max-w-[85%] space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Icon icon="tabler:shield-question" width={16} height={16} className="text-warning" />
                    <span className="font-medium">Allow the assistant to {action}?</span>
                  </div>
                  {detail && <div className="text-xs text-default-500 break-words pl-6">{detail}</div>}
                  {decided ? (
                    <div className={`text-xs pl-6 font-medium ${decided === 'allow' ? 'text-success' : 'text-danger'}`}>
                      {decided === 'allow' ? '✓ Allowed' : '✕ Denied'}
                    </div>
                  ) : (
                    <div className="flex gap-2 pl-6">
                      <Button size="sm" color="primary" onPress={() => respondPermission(t.requestId, true)}>
                        Allow
                      </Button>
                      <Button size="sm" variant="flat" onPress={() => respondPermission(t.requestId, false)}>
                        Deny
                      </Button>
                    </div>
                  )}
                </article>
              );
            }
            // assistant turn
            if (t.toolCalls.length === 0 && !t.text) return null;
            return (
              <article key={i} className="space-y-2">
                {t.toolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.toolCalls.map((tc, j) => {
                      const meta = TOOL_LABEL[tc.tool] ?? { icon: 'tabler:tool', label: tc.tool };
                      return (
                        <Chip
                          key={j}
                          size="sm"
                          variant="flat"
                          color="default"
                          startContent={<Icon icon={meta.icon} width={12} height={12} />}
                        >
                          {meta.label}
                        </Chip>
                      );
                    })}
                  </div>
                )}
                {t.text && (
                  <div className="rounded-2xl rounded-bl-md bg-content1 border border-divider px-4 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words">
                    {t.text}
                  </div>
                )}
              </article>
            );
          })}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-default-500">
              <Icon icon="tabler:loader-2" width={14} height={14} className="animate-spin" />
              thinking…
            </div>
          )}
        </div>
      </ScrollArea>

      <footer
        className={`border-t border-divider px-4 md:px-8 py-3 bg-content1 relative ${isDragging ? 'ring-2 ring-primary ring-inset' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) addImageFiles(e.dataTransfer.files);
        }}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-primary/5 flex items-center justify-center pointer-events-none text-xs text-primary font-medium">
            Drop images to attach
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addImageFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {pendingImages.length > 0 && (
          <div className="max-w-3xl mx-auto mb-2 flex flex-wrap gap-2">
            {pendingImages.map((p) => (
              <div key={p.id} className="relative group">
                <img src={p.dataUrl} alt="attachment" className="h-16 w-16 object-cover rounded-lg border border-divider" />
                <button
                  type="button"
                  onClick={() => removePendingImage(p.id)}
                  className="absolute -top-1.5 -right-1.5 bg-default-900 text-default-50 rounded-full w-5 h-5 flex items-center justify-center opacity-90 hover:opacity-100"
                  aria-label="Remove image"
                >
                  <Icon icon="tabler:x" width={11} height={11} />
                </button>
              </div>
            ))}
            {pendingImages.length < MAX_PENDING_IMAGES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-16 w-16 rounded-lg border border-dashed border-divider text-default-400 hover:text-primary hover:border-primary flex items-center justify-center"
                aria-label="Add another image"
              >
                <Icon icon="tabler:plus" width={18} height={18} />
              </button>
            )}
          </div>
        )}

        <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2">
          <Tooltip content="Shift+Tab to cycle modes" placement="top">
            <button
              type="button"
              onClick={cycleMode}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === 'normal'      ? 'border-default-300 text-default-600 hover:bg-default-100'
                : mode === 'acceptEdits' ? 'border-warning/50 text-warning hover:bg-warning/10'
                :                          'border-primary/50 text-primary hover:bg-primary/10'
              }`}
              aria-label={`Mode: ${MODE_META[mode].label}. Shift+Tab to change.`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${MODE_META[mode].dot}`} />
              <Icon icon={MODE_META[mode].icon} width={13} height={13} />
              {MODE_META[mode].label}
            </button>
          </Tooltip>
          <span className="text-[11px] text-default-400">
            {MODE_META[mode].hint} · <kbd className="font-mono">Shift+Tab</kbd> to switch
          </span>
        </div>

        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <Tooltip content="Attach image (or paste / drag-and-drop)" placement="top">
            <Button
              size="sm"
              variant="flat"
              isIconOnly
              onPress={() => fileInputRef.current?.click()}
              isDisabled={pendingImages.length >= MAX_PENDING_IMAGES}
              aria-label="Attach image"
              className="mb-0.5"
            >
              <Icon icon="tabler:paperclip" width={16} height={16} />
            </Button>
          </Tooltip>
          <Textarea
            minRows={1}
            maxRows={6}
            value={input}
            placeholder={hasMessages ? 'Continue the conversation…' : 'Ask the assistant…'}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              } else if (e.key === 'Tab' && e.shiftKey) {
                // Shift+Tab cycles modes, just like Claude Code in the terminal.
                e.preventDefault();
                cycleMode();
              }
            }}
            classNames={{ inputWrapper: 'min-h-[40px]' }}
          />
          <Button
            color="primary"
            isIconOnly
            isLoading={busy}
            isDisabled={!input.trim() && pendingImages.length === 0}
            onPress={() => send()}
            aria-label="Send"
          >
            {!busy && <Icon icon="tabler:send" width={16} height={16} />}
          </Button>
        </div>
        <div className="max-w-3xl mx-auto text-[10px] text-default-400 mt-1.5 text-center">
          Press <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> newline · paste or drag to attach
        </div>
      </footer>
    </div>
  );
});

export default AssistantPage;
