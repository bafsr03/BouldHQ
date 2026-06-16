// Brand-owner mobile-first dashboard. Three tabs at the bottom (iOS pattern):
// Submit (compose request) / Requests (track) / Brand (read team notes).
// All scoped to the owner's single store via brandOwnerProcedure on the server.

import { observer } from 'mobx-react-lite';
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spinner, Textarea } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { useVoiceRecorder, formatRecorderDuration } from '@/hooks/useVoiceRecorder';

type Tab = 'submit' | 'requests' | 'brand';

type Me = {
  ownerId: number;
  accountId: number;
  name: string;
  email: string;
  tagId: number;
  storeName: string;
  storeUrl: string | null;
};

const OwnerDashboard = observer(() => {
  const navigate = useNavigate();
  const user = RootStore.Get(UserStore);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('submit');

  useEffect(() => {
    // If we're not logged in as a brand owner, bounce.
    if (!user.token) { navigate('/owner/login'); return; }
    if (user.role && user.role !== 'brand_owner') { navigate('/'); return; }
    api.brandOwner.me.query()
      .then((m) => setMe(m as Me))
      .catch(() => navigate('/owner/login'))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !me) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="px-4 py-3 border-b border-divider bg-content1 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-default-500">Your brand</div>
          <div className="font-semibold truncate">{me.storeName}</div>
        </div>
        <Button
          size="sm" variant="light" isIconOnly
          aria-label="Sign out"
          onPress={() => { user.tokenData.save(null); navigate('/owner/login'); }}
        >
          <Icon icon="tabler:logout" width={18} height={18} />
        </Button>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {tab === 'submit' && <SubmitTab me={me} onSubmitted={() => setTab('requests')} />}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'brand' && <BrandTab />}
      </main>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 inset-x-0 border-t border-divider bg-content1/95 backdrop-blur safe-bottom"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-3">
          <TabButton active={tab === 'submit'}   onPress={() => setTab('submit')}
            icon="tabler:edit"  label="Submit" />
          <TabButton active={tab === 'requests'} onPress={() => setTab('requests')}
            icon="tabler:list-check" label="Requests" />
          <TabButton active={tab === 'brand'}    onPress={() => setTab('brand')}
            icon="tabler:notebook" label="My brand" />
        </div>
      </nav>
    </div>
  );
});

const TabButton = ({
  active, onPress, icon, label,
}: { active: boolean; onPress: () => void; icon: string; label: string }) => (
  <button
    type="button"
    onClick={onPress}
    className={`py-3 flex flex-col items-center gap-0.5 text-xs transition-colors ${
      active ? 'text-primary' : 'text-default-500 hover:text-default-700'
    }`}
  >
    <Icon icon={icon} width={22} height={22} />
    {label}
  </button>
);

// -- Submit tab --------------------------------------------------------------

type Attachment = { path: string; name: string; type: string; size: number };

const SubmitTab = ({ me, onSubmitted }: { me: Me; onSubmitted: () => void }) => {
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const recorder = useVoiceRecorder();

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

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files) {
      const att = await uploadFile(file);
      if (att) setAttachments((prev) => [...prev, att]);
    }
  };

  const onStopRecording = async () => {
    const blob = await recorder.stop();
    if (!blob) return;
    const filename = `voice-memo-${Date.now()}.webm`;
    const file = new File([blob], filename, { type: blob.type || 'audio/webm' });
    const att = await uploadFile(file);
    if (att) setAttachments((prev) => [...prev, att]);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.brandOwner.submitRequest.mutate({
        rawBody: body.trim(),
        attachmentPaths: attachments.map((a) => a.path),
      });
      setBody('');
      setAttachments([]);
      setPosted(true);
      setTimeout(() => { setPosted(false); onSubmitted(); }, 1200);
    } catch (e: any) {
      setError(e?.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = body.trim().length > 0 || attachments.length > 0;

  if (posted) {
    return (
      <div className="px-4 py-12 text-center space-y-3">
        <div className="mx-auto inline-flex items-center justify-center size-14 rounded-full bg-success/10 text-success">
          <Icon icon="tabler:check" width={28} height={28} />
        </div>
        <p className="font-medium">Got it — our team is on it.</p>
        <p className="text-sm text-default-500">Track progress in Requests below.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3">
      <div>
        <h1 className="text-xl font-bold">What do you need?</h1>
        <p className="text-sm text-default-500 mt-0.5">
          Anything — copy updates, design tweaks, bug fixes, questions. Add a voice memo, photo, or file.
        </p>
      </div>

      <Textarea
        size="lg"
        minRows={6}
        value={body}
        placeholder="e.g. 'Update the About page bios — Gracie just shared her full story…'"
        onChange={(e) => setBody(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={(e) => onPickFile(e)} />
        <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => onPickFile(e)} />

        <Button size="md" variant="flat"
          isDisabled={uploading || recorder.status === 'recording'}
          startContent={<Icon icon="tabler:paperclip" width={16} height={16} />}
          onPress={() => fileInputRef.current?.click()}>
          File
        </Button>
        <Button size="md" variant="flat"
          isDisabled={uploading || recorder.status === 'recording'}
          startContent={<Icon icon="tabler:camera" width={16} height={16} />}
          onPress={() => imageInputRef.current?.click()}>
          Photo
        </Button>
        {recorder.status === 'recording' ? (
          <Button size="md" color="danger" variant="flat"
            startContent={<Icon icon="tabler:player-stop-filled" width={16} height={16} />}
            onPress={onStopRecording}>
            Stop · {formatRecorderDuration(recorder.durationMs)}
          </Button>
        ) : (
          <Button size="md" variant="flat"
            isDisabled={uploading || recorder.status === 'unsupported'}
            startContent={<Icon icon="tabler:microphone" width={16} height={16} />}
            onPress={recorder.start}>
            Voice
          </Button>
        )}
        {uploading && (
          <span className="text-xs text-default-500 flex items-center gap-1">
            <Spinner size="sm" /> Uploading…
          </span>
        )}
      </div>

      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((a) => (
            <li key={a.path}
              className="flex items-center gap-2 px-2 py-2 rounded border border-divider bg-content1 text-sm">
              <Icon icon={
                a.type.startsWith('audio/') ? 'tabler:microphone' :
                a.type.startsWith('image/') ? 'tabler:photo' : 'tabler:file'
              } width={16} height={16} className="text-default-500 shrink-0" />
              <span className="truncate flex-1">{a.name}</span>
              <button type="button"
                onClick={() => setAttachments((p) => p.filter((x) => x.path !== a.path))}
                className="text-default-400 hover:text-danger shrink-0"
                aria-label="Remove">
                <Icon icon="tabler:x" width={16} height={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {recorder.error && (
        <div className="rounded-md bg-warning/10 border border-warning/30 text-warning text-sm px-3 py-2">
          {recorder.error}
        </div>
      )}
      {error && (
        <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">
          {error}
        </div>
      )}

      <Button
        size="lg" color="primary" fullWidth
        isLoading={submitting}
        isDisabled={!canSubmit || uploading}
        onPress={submit}
      >
        Send to {me.storeName}'s team
      </Button>
    </div>
  );
};

// -- Requests tab ------------------------------------------------------------

const STATUS_LABEL: Record<string, { label: string; color: string; icon: string }> = {
  pending_triage:   { label: 'Triaging',     color: 'text-default-500', icon: 'tabler:loader-2' },
  auto_running:     { label: 'Agent working', color: 'text-primary',     icon: 'tabler:robot' },
  auto_done:        { label: 'Done',          color: 'text-success',     icon: 'tabler:check' },
  needs_assistance: { label: 'Needs review',  color: 'text-warning',     icon: 'tabler:alert-triangle' },
  in_progress:      { label: 'In progress',   color: 'text-secondary',   icon: 'tabler:user' },
  done:             { label: 'Done',          color: 'text-success',     icon: 'tabler:check' },
};

const RequestsTab = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.brandOwner.listMyRequests.query({ limit: 50 })
      .then((r) => setRows(r as any[]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center"><Spinner size="sm" /></div>;
  if (rows.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm text-default-500 space-y-2">
        <Icon icon="tabler:inbox" width={28} height={28} className="mx-auto opacity-60" />
        <p>No requests yet. Tap Submit to send your first one.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-divider">
      {rows.map((r) => {
        const meta = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending_triage;
        return (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon icon={meta.icon} width={14} height={14} className={meta.color} />
              <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
              <span className="text-xs text-default-400 font-mono tabular-nums ml-auto">#{r.id}</span>
            </div>
            <div className="text-sm text-default-700 line-clamp-2 break-words">{r.rawBody}</div>
            {r.runLogSummary && (
              <div className="text-xs text-default-500 mt-1 italic line-clamp-2">
                {r.runLogSummary}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// -- Brand tab ---------------------------------------------------------------

const BrandTab = () => {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.brandOwner.listMyBrandNotes.query({ limit: 100 })
      .then((r) => setNotes(r as any[]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center"><Spinner size="sm" /></div>;

  return (
    <div className="px-4 py-3 space-y-3">
      <div>
        <h1 className="text-xl font-bold">What we know about your brand</h1>
        <p className="text-sm text-default-500 mt-0.5">
          Brand voice, decisions, and context our team has collected. If anything's off, submit a request to update.
        </p>
      </div>
      {notes.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-default-500">
          <Icon icon="tabler:notebook" width={24} height={24} className="mx-auto opacity-60 mb-2" />
          <p>Nothing on file yet. Send us anything you'd like us to remember.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-divider bg-content1 p-3">
              <div className="text-xs text-default-500 mb-1 flex items-center gap-2">
                {n.author && <span>by {n.author}</span>}
                <span>·</span>
                <span>{new Date(n.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap break-words">{n.content}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default OwnerDashboard;
