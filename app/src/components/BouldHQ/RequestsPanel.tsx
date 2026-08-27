import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Chip, Textarea, Modal, ModalContent, ModalHeader,
  ModalBody, ModalFooter, useDisclosure, Spinner,
} from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { useVoiceRecorder, formatRecorderDuration } from '@/hooks/useVoiceRecorder';

type Status =
  | 'pending_triage' | 'auto_running' | 'auto_done'
  | 'needs_assistance' | 'in_progress' | 'done';

const STATUS_META: Record<Status, { label: string; color: any; icon: string }> = {
  pending_triage:   { label: 'triaging…',         color: 'default', icon: 'tabler:loader-2' },
  auto_running:     { label: 'auto running',      color: 'primary', icon: 'tabler:robot' },
  auto_done:        { label: 'auto done',         color: 'success', icon: 'tabler:robot' },
  needs_assistance: { label: 'needs assistance',  color: 'warning', icon: 'tabler:alert-triangle' },
  in_progress:      { label: 'in progress',       color: 'secondary', icon: 'tabler:user' },
  done:             { label: 'done',              color: 'success', icon: 'tabler:check' },
};

const FILTERS: { key: 'all' | 'open' | Status; label: string }[] = [
  { key: 'all',              label: 'All' },
  { key: 'open',             label: 'Open' },
  { key: 'needs_assistance', label: 'Needs assistance' },
  { key: 'in_progress',      label: 'In progress' },
  { key: 'auto_done',        label: 'Auto done' },
  { key: 'done',             label: 'Done' },
];

const OPEN_STATUSES: Status[] = ['pending_triage', 'auto_running', 'needs_assistance', 'in_progress'];

const SOURCE_META: Record<string, { icon: string; label: string }> = {
  text:       { icon: 'tabler:message',     label: 'text' },
  voice:      { icon: 'tabler:microphone',  label: 'voice' },
  screenshot: { icon: 'tabler:photo',       label: 'image' },
  email:      { icon: 'tabler:mail',        label: 'email' },
};

type Request = {
  id: number;
  status: Status;
  source: string;
  rawBody: string;
  triageResult: any;
  runLog: PlaybookRunLog | null;
  managerNotes: string | null;
  createdById: number;
  assigneeId: number | null;
  attachmentIds?: number[];
  createdAt: Date | string;
  updatedAt: Date | string;
  closedAt: Date | string | null;
};

type HumanBrief = {
  title: string;
  checklist: string[];
  context_for_human: string;
};

type AgentAction = {
  kind: string;
  title?: string;
  file?: string;
  noteId?: number;
  preview?: string;
};

type PlaybookRunLog = {
  startedAt: string;
  finishedAt: string;
  category: string;
  status?: 'auto_done' | 'needs_assistance' | 'blocked';
  summary: string;
  error?: string;
  steps: Array<{ at: string; level: 'info' | 'ok' | 'warn' | 'fail'; message: string }>;
  brief?: HumanBrief;
  actions?: AgentAction[];
  questions?: string[];
};

// ---------------------------------------------------------------------------

export const RequestsPanel = observer(({ tagId, tagName }: { tagId: number; tagName: string }) => {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to the "Open" bucket so closed requests (auto_done / done) drop
  // out of view as soon as the agent finishes. They're still one tap away
  // under the Auto done / Done filters; nothing is hidden, just out of focus.
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('open');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [role, setRole] = useState<'founder' | 'manager' | 'salesman' | null>(null);
  const composer = useDisclosure();

  const refresh = async () => {
    try {
      const list = await api.storeRequest.list.query({ tagId, limit: 200 });
      setRequests(list as Request[]);
    } catch (err) {
      console.error('list requests failed', err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, team] = await Promise.all([
          api.storeRequest.list.query({ tagId, limit: 200 }),
          api.team.current.query().catch(() => null),
        ]);
        if (cancelled) return;
        setRequests(list as Request[]);
        setRole(team?.role ?? null);
      } catch (err) {
        console.error('panel load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tagId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    if (filter === 'open') return requests.filter((r) => OPEN_STATUSES.includes(r.status));
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length, open: 0 };
    for (const r of requests) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (OPEN_STATUSES.includes(r.status)) c.open++;
    }
    return c;
  }, [requests]);

  const isManager = role === 'manager' || role === 'founder';

  return (
    <section aria-label="Requests" className="rounded-xl border border-divider bg-content1">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-divider">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600 mr-auto">
          Requests
        </h2>
        <Button
          size="sm"
          color="primary"
          variant="flat"
          onPress={composer.onOpen}
          startContent={<Icon icon="tabler:plus" width={14} height={14} />}
        >
          New request
        </Button>
      </header>

      <div className="px-4 py-2 border-b border-divider flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`text-xs px-2 py-1 rounded-md border transition-colors tabular-nums ${
              filter === f.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-divider text-default-600 hover:bg-default-100'
            }`}
          >
            {f.label}
            {counts[f.key] !== undefined && (
              <span className="ml-1 text-default-400">{counts[f.key] ?? 0}</span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="px-4 py-8 text-center"><Spinner size="sm" /></div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="px-4 py-10 text-center text-sm text-default-500">
          <Icon icon="tabler:flame-off" width={28} height={28} className="mx-auto mb-2 opacity-60" />
          {filter === 'all'
            ? 'No requests for this store yet. Add the first one with "New request".'
            : 'Nothing in this bucket.'}
        </div>
      )}

      <ul className="divide-y divide-divider">
        {filtered.map((r) => {
          const meta = STATUS_META[r.status];
          const isOpen = expandedId === r.id;
          const sourceMeta = SOURCE_META[r.source] ?? SOURCE_META.text;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : r.id)}
                className="w-full grid grid-cols-12 gap-2 items-start text-left px-4 py-3 hover:bg-default-100/60 transition-colors"
                aria-expanded={isOpen}
              >
                <div className="col-span-12 md:col-span-7 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Chip size="sm" variant="flat" color={meta.color}
                      startContent={<Icon icon={meta.icon} width={12} height={12} />}>
                      {meta.label}
                    </Chip>
                    <Chip size="sm" variant="flat" color="default"
                      startContent={<Icon icon={sourceMeta.icon} width={12} height={12} />}>
                      {sourceMeta.label}
                    </Chip>
                    <span className="text-xs text-default-400 font-mono tabular-nums">#{r.id}</span>
                  </div>
                  <div className="text-sm text-default-700 line-clamp-2 break-words">
                    {r.rawBody}
                  </div>
                </div>
                <div className="col-span-8 md:col-span-4 text-xs text-default-500">
                  {r.runLog?.brief ? (
                    <span className="line-clamp-2 break-words">
                      <span className="font-medium text-warning">Brief:</span>{' '}
                      {r.runLog.brief.title}
                    </span>
                  ) : r.triageResult?.suggestedAction ? (
                    <span className="line-clamp-2 break-words">
                      <span className="font-medium text-default-700">Suggested:</span>{' '}
                      {r.triageResult.suggestedAction}
                    </span>
                  ) : r.status === 'pending_triage' ? (
                    <span className="italic">Awaiting triage…</span>
                  ) : (
                    <span className="text-default-400">No suggested action</span>
                  )}
                </div>
                <div className="col-span-4 md:col-span-1 text-right text-default-400">
                  <Icon icon={isOpen ? 'tabler:chevron-up' : 'tabler:chevron-down'} width={16} height={16} className="inline" />
                </div>
              </button>

              {isOpen && (
                <RequestDetail
                  request={r}
                  isManager={isManager}
                  onChanged={refresh}
                />
              )}
            </li>
          );
        })}
      </ul>

      <ComposerModal
        tagId={tagId}
        tagName={tagName}
        disclosure={composer}
        onCreated={async () => { composer.onClose(); await refresh(); }}
      />
    </section>
  );
});

// -- Expanded detail block ---------------------------------------------------

const RequestDetail = ({
  request, isManager, onChanged,
}: { request: Request; isManager: boolean; onChanged: () => void | Promise<void> }) => {
  const [busy, setBusy] = useState<string | null>(null);

  const action = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); await onChanged(); } catch (err) { console.error(label, err); }
    finally { setBusy(null); }
  };

  const brief = request.runLog?.brief;
  const actions = request.runLog?.actions ?? [];
  const questions = request.runLog?.questions ?? [];

  return (
    <div className="bg-default-50 border-t border-divider px-4 py-3 space-y-3 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wider text-default-500 mb-1">Raw body</div>
        <pre className="whitespace-pre-wrap font-mono text-xs bg-content1 border border-divider rounded p-2 max-h-48 overflow-auto">
          {request.rawBody}
        </pre>
      </div>

      {/* Human brief — shows the agent's hand-off when status=needs_assistance */}
      {brief && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon icon="tabler:hand-stop" width={14} height={14} className="text-warning" />
            <span className="text-xs uppercase tracking-wider text-warning font-semibold">
              Agent needs your help
            </span>
          </div>
          <div className="text-sm font-semibold mb-2">{brief.title}</div>
          {brief.checklist.length > 0 && (
            <ul className="space-y-1 mb-2">
              {brief.checklist.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <Icon icon="tabler:square" width={14} height={14} className="text-default-400 mt-0.5 shrink-0" />
                  <span className="break-words">{item}</span>
                </li>
              ))}
            </ul>
          )}
          {brief.context_for_human && (
            <p className="text-xs text-default-700 whitespace-pre-wrap">{brief.context_for_human}</p>
          )}
        </div>
      )}

      {/* What the agent did — draft notes etc. */}
      {actions.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-default-500 mb-1">Agent output</div>
          <ul className="space-y-1.5">
            {actions.map((a, i) => (
              <li key={i} className="rounded border border-divider bg-content1 px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Icon
                    icon={a.kind === 'note_created' ? 'tabler:note' : 'tabler:file-text'}
                    width={12} height={12} className="text-primary"
                  />
                  <span className="font-medium">{a.title || a.file || a.kind}</span>
                  {a.noteId && (
                    <Chip size="sm" variant="flat" color="primary" className="ml-auto">
                      note #{a.noteId}
                    </Chip>
                  )}
                </div>
                {a.preview && (
                  <pre className="whitespace-pre-wrap text-default-600 line-clamp-3 font-sans">
                    {a.preview}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {questions.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-default-500 mb-1">Open questions for the owner</div>
          <ul className="space-y-1 text-xs">
            {questions.map((q, i) => (
              <li key={i} className="flex items-start gap-2">
                <Icon icon="tabler:help-circle" width={12} height={12} className="text-warning mt-0.5 shrink-0" />
                <span className="break-words">{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {request.triageResult && (
        <div>
          <div className="text-xs uppercase tracking-wider text-default-500 mb-1">AI triage</div>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
            <dt className="text-default-500">Decision</dt>
            <dd className="col-span-2">
              {request.triageResult.canAutomate
                ? <Chip size="sm" variant="flat" color="primary">automatable</Chip>
                : <Chip size="sm" variant="flat" color="warning">needs human</Chip>}
            </dd>
            <dt className="text-default-500">Category</dt>
            <dd className="col-span-2 font-mono">{request.triageResult.category}</dd>
            <dt className="text-default-500">Reasoning</dt>
            <dd className="col-span-2">{request.triageResult.reasoning}</dd>
            <dt className="text-default-500">Suggested</dt>
            <dd className="col-span-2">{request.triageResult.suggestedAction}</dd>
          </dl>
        </div>
      )}

      {request.runLog && (
        <details className="text-xs">
          <summary className="cursor-pointer text-default-500 uppercase tracking-wider">
            Playbook trace ({request.runLog.steps.length} steps)
          </summary>
          <div className="mt-1.5">
            <div className="text-xs text-default-700 mb-1.5">{request.runLog.summary}</div>
            <ol className="rounded border border-divider bg-content1 divide-y divide-divider text-[11px] font-mono max-h-48 overflow-auto">
              {request.runLog.steps.map((s, i) => (
                <li key={i} className="px-2 py-1 flex items-start gap-2">
                  <span
                    className={`tabular-nums shrink-0 mt-0.5 ${
                      s.level === 'ok'   ? 'text-success' :
                      s.level === 'fail' ? 'text-danger' :
                      s.level === 'warn' ? 'text-warning' : 'text-default-400'
                    }`}
                  >
                    {s.level.padEnd(4)}
                  </span>
                  <span className="break-words">{s.message}</span>
                </li>
              ))}
            </ol>
            {request.runLog.error && (
              <div className="mt-1.5 rounded bg-danger/10 border border-danger/30 text-danger text-[11px] font-mono px-2 py-1">
                {request.runLog.error}
              </div>
            )}
          </div>
        </details>
      )}

      {request.managerNotes && (
        <div>
          <div className="text-xs uppercase tracking-wider text-default-500 mb-1">Manager notes</div>
          <p className="text-xs">{request.managerNotes}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {isManager ? (
          <>
            <Button
              size="sm" variant="solid" color="primary"
              isLoading={busy === 'open_terminal'}
              title="Open this store in Antigravity IDE and resume the agent's session (claude --continue)"
              onPress={() => action('open_terminal', () => api.storeRequest.openTerminal.mutate({ id: request.id }))}
              startContent={!busy && <Icon icon="tabler:terminal-2" width={14} height={14} />}
            >Connect</Button>

            <Button
              size="sm" variant="flat"
              isLoading={busy === 'retriage'}
              onPress={() => action('retriage', () => api.storeRequest.runTriage.mutate({ id: request.id }))}
              startContent={!busy && <Icon icon="tabler:refresh" width={14} height={14} />}
            >Re-run triage</Button>

            <Button
              size="sm" variant="flat" color="primary"
              isLoading={busy === 'runplaybook'}
              onPress={() => action('runplaybook', () => api.storeRequest.runPlaybook.mutate({ id: request.id }))}
              startContent={!busy && <Icon icon="tabler:robot" width={14} height={14} />}
            >Re-run agent</Button>

            {request.status !== 'in_progress' && (
              <Button
                size="sm" variant="flat" color="secondary"
                isLoading={busy === 'in_progress'}
                onPress={() => action('in_progress', () => api.storeRequest.updateStatus.mutate({ id: request.id, status: 'in_progress' }))}
                startContent={!busy && <Icon icon="tabler:user" width={14} height={14} />}
              >Take on</Button>
            )}

            {request.status !== 'needs_assistance' && (
              <Button
                size="sm" variant="flat" color="warning"
                isLoading={busy === 'needs_assistance'}
                onPress={() => action('needs_assistance', () => api.storeRequest.updateStatus.mutate({ id: request.id, status: 'needs_assistance' }))}
                startContent={!busy && <Icon icon="tabler:alert-triangle" width={14} height={14} />}
              >Flag</Button>
            )}

            {request.status !== 'done' && (
              <Button
                size="sm" variant="flat" color="success"
                isLoading={busy === 'done'}
                onPress={() => action('done', () => api.storeRequest.updateStatus.mutate({ id: request.id, status: 'done' }))}
                startContent={!busy && <Icon icon="tabler:check" width={14} height={14} />}
              >Mark done</Button>
            )}
          </>
        ) : (
          <span className="text-xs text-default-500 italic">
            Only managers can change request status. Add detail by editing the request body or leaving a follow-up.
          </span>
        )}
      </div>
    </div>
  );
};

// -- Composer: textarea + inline attachment affordances ----------------------

type Attachment = { path: string; name: string; type: string; size: number };

const ComposerModal = ({
  tagId, tagName, disclosure, onCreated,
}: {
  tagId: number; tagName: string;
  disclosure: ReturnType<typeof useDisclosure>;
  onCreated: () => void | Promise<void>;
}) => {
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const recorder = useVoiceRecorder();

  const reset = () => {
    setBody('');
    setAttachments([]);
    setError(null);
    recorder.cancel();
  };

  // Single upload primitive used by file/image/voice paths so behavior is
  // consistent — POST to /api/file/upload with the auth token, get back
  // { filePath, fileName, type, size }, return our Attachment shape.
  const uploadFile = async (file: File): Promise<Attachment | null> => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = RootStore.Get(UserStore).tokenData.value?.token;
      const res = await fetch(getBlinkoEndpoint('/api/file/upload'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json();
      const path = data?.filePath || data?.path;
      if (!path) throw new Error('Upload returned no path');
      return {
        path,
        name: data?.fileName || file.name,
        type: data?.type || file.type || 'application/octet-stream',
        size: typeof data?.size === 'number' ? data.size : file.size,
      };
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>, accept?: 'image') => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files) {
      const att = await uploadFile(file);
      if (att) setAttachments((prev) => [...prev, att]);
    }
    if (accept === 'image') imageInputRef.current && (imageInputRef.current.value = '');
  };

  const onStopRecording = async () => {
    const blob = await recorder.stop();
    if (!blob) return;
    const filename = `voice-memo-${Date.now()}.webm`;
    const file = new File([blob], filename, { type: blob.type || 'audio/webm' });
    const att = await uploadFile(file);
    if (att) setAttachments((prev) => [...prev, att]);
  };

  const removeAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.storeRequest.create.mutate({
        tagId,
        rawBody: body.trim(),
        attachmentPaths: attachments.map((a) => a.path),
      });
      reset();
      await onCreated();
    } catch (e: any) {
      setError(e?.message || 'Failed to create request');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = body.trim().length > 0 || attachments.length > 0;

  return (
    <Modal
      isOpen={disclosure.isOpen}
      onClose={() => { reset(); disclosure.onClose(); }}
      size="2xl"
    >
      <ModalContent>
        <ModalHeader>
          New request — <span className="font-normal text-default-500">#{tagName}</span>
        </ModalHeader>
        <ModalBody className="space-y-3">
          <Textarea
            autoFocus
            size="sm"
            minRows={5}
            value={body}
            placeholder="What needs to happen? Paste the email, drop in chat text, or describe the ask. Attach files, screenshots, or a voice memo below."
            onChange={(e) => setBody(e.target.value)}
          />

          {/* Attachment row — three real input modes inline */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onPickFile(e)}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onPickFile(e, 'image')}
            />

            <Button
              size="sm"
              variant="flat"
              isDisabled={uploading || recorder.status === 'recording'}
              startContent={<Icon icon="tabler:paperclip" width={14} height={14} />}
              onPress={() => fileInputRef.current?.click()}
            >
              Attach file
            </Button>

            <Button
              size="sm"
              variant="flat"
              isDisabled={uploading || recorder.status === 'recording'}
              startContent={<Icon icon="tabler:photo" width={14} height={14} />}
              onPress={() => imageInputRef.current?.click()}
            >
              Add image
            </Button>

            {recorder.status === 'recording' ? (
              <Button
                size="sm"
                color="danger"
                variant="flat"
                isLoading={recorder.status === 'recording' && uploading}
                startContent={<Icon icon="tabler:player-stop-filled" width={14} height={14} />}
                onPress={onStopRecording}
              >
                Stop · {formatRecorderDuration(recorder.durationMs)}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="flat"
                isDisabled={uploading || recorder.status === 'unsupported'}
                startContent={<Icon icon="tabler:microphone" width={14} height={14} />}
                onPress={recorder.start}
              >
                Voice memo
              </Button>
            )}

            {uploading && (
              <span className="text-xs text-default-500 flex items-center gap-1">
                <Spinner size="sm" /> Uploading…
              </span>
            )}
          </div>

          {/* Attached items */}
          {attachments.length > 0 && (
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li
                  key={a.path}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border border-divider bg-content1 text-xs"
                >
                  <Icon
                    icon={
                      a.type.startsWith('audio/') ? 'tabler:microphone' :
                      a.type.startsWith('image/') ? 'tabler:photo' :
                      'tabler:file'
                    }
                    width={14} height={14}
                    className="text-default-500 shrink-0"
                  />
                  <span className="truncate flex-1">{a.name}</span>
                  <span className="text-default-400 tabular-nums shrink-0">
                    {formatBytes(a.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.path)}
                    className="text-default-400 hover:text-danger transition-colors shrink-0"
                    aria-label="Remove attachment"
                  >
                    <Icon icon="tabler:x" width={14} height={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {recorder.error && (
            <div className="rounded-md bg-warning/10 border border-warning/30 text-warning text-xs px-3 py-2">
              {recorder.error}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">
              {error}
            </div>
          )}

          <p className="text-[11px] text-default-500">
            The AI agent triages, materializes the store's notes + assets, and either fixes the
            request autonomously or hands back a checklist with everything you need to finish it.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => { reset(); disclosure.onClose(); }}>Cancel</Button>
          <Button
            color="primary"
            isLoading={submitting}
            isDisabled={!canSubmit || uploading}
            onPress={submit}
          >
            Open request
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

function formatBytes(n: number): string {
  if (!n || n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
