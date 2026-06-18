// Brand-owner portal — two-page layout.
// Page 1 (Feed): read-only team announcements.
// Page 2 (My Store): three inner tabs — Request / Notes / Reports.

import { observer } from 'mobx-react-lite';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spinner } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { useVoiceRecorder, formatRecorderDuration } from '@/hooks/useVoiceRecorder';
import { HtmlPreviewModal } from '@/components/BouldHQ/HtmlPreviewModal';

type Page = 'feed' | 'store';
type StoreTab = 'request' | 'notes' | 'reports';

type Me = {
  ownerId: number;
  accountId: number;
  name: string;
  email: string;
  tagId: number;
  storeName: string;
  storeUrl: string | null;
};

// Auto-resize a native textarea to fit its content.
const autoResize = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

// Scroll into view after iOS keyboard finishes appearing (350ms delay).
const scrollIntoView = (el: HTMLElement | null) => {
  if (!el) return;
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
};

// Shared textarea styles — 16px font prevents iOS Safari auto-zoom on focus.
const TEXTAREA_CLASS =
  'w-full rounded-xl border border-divider bg-content2 px-3 py-3 text-foreground ' +
  'placeholder:text-default-400 focus:outline-none focus:border-primary ' +
  'transition-colors resize-none overflow-hidden leading-relaxed';

// ─── Root ────────────────────────────────────────────────────────────────────

const OwnerDashboard = observer(() => {
  const navigate = useNavigate();
  const user = RootStore.Get(UserStore);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>('feed');

  useEffect(() => {
    if (!user.token) { navigate('/owner/login'); return; }
    if (user.role && user.role !== 'brand_owner') { navigate('/'); return; }
    api.brandOwner.me.query()
      .then((m) => setMe(m as Me))
      .catch(() => navigate('/owner/login'))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !me) {
    return (
      <div
        className="flex items-center justify-center bg-background"
        style={{ height: '100dvh' }}
      >
        <Spinner />
      </div>
    );
  }

  // Layout: flex column with height=100dvh (shrinks when mobile keyboard opens).
  // Nav is a normal flex child at the bottom — NOT fixed — so iOS doesn't show
  // it floating above the keyboard.
  return (
    <div
      className="bg-background flex flex-col"
      style={{ height: '100dvh', overflow: 'hidden' }}
    >
      {/* Top bar */}
      <header className="px-4 py-3 border-b border-divider bg-content1 flex items-center gap-3 flex-shrink-0">
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

      {/* Scrollable content */}
      <main className="flex-1 overflow-y-auto">
        {page === 'feed' && <FeedPage />}
        {page === 'store' && <StorePage me={me} />}
      </main>

      {/* Bottom nav — flex child, NOT fixed. Moves with the viewport when
          the iOS keyboard opens because 100dvh shrinks to match visual viewport. */}
      <nav
        className="flex-shrink-0 border-t border-divider bg-content1 grid grid-cols-2"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <NavButton active={page === 'feed'}  onPress={() => setPage('feed')}
          icon="tabler:speakerphone" label="Feed" />
        <NavButton active={page === 'store'} onPress={() => setPage('store')}
          icon="tabler:building-store" label="My Store" />
      </nav>
    </div>
  );
});

const NavButton = ({
  active, onPress, icon, label,
}: { active: boolean; onPress: () => void; icon: string; label: string }) => (
  <button
    type="button"
    onClick={onPress}
    className={`py-3 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors ${
      active ? 'text-primary' : 'text-default-500'
    }`}
  >
    <Icon icon={icon} width={22} height={22} />
    {label}
  </button>
);

// ─── Page 1: Feed ────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, { label: string; color: string }> = {
  announcement:    { label: 'Announcement',    color: 'text-primary bg-primary/10' },
  changelog:       { label: 'Changelog',       color: 'text-success bg-success/10' },
  workflow_update: { label: 'Workflow update', color: 'text-warning bg-warning/10' },
};

const FeedPage = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    api.brandOwner.listAnnouncements.query()
      .then((r) => setItems(r as any[]))
      .catch((e) => setFetchError(e?.message || 'Could not load announcements'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (loading) return <div className="p-8 text-center"><Spinner size="sm" /></div>;

  return (
    <div className="px-4 py-4 space-y-3">
      <div>
        <h1 className="text-xl font-bold">What's happening</h1>
        <p className="text-sm text-default-500 mt-0.5">Updates and announcements from your team.</p>
      </div>

      {fetchError && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm px-4 py-3">
          {fetchError}
        </div>
      )}

      {!fetchError && items.length === 0 && (
        <div className="py-12 text-center text-sm text-default-500 space-y-2">
          <Icon icon="tabler:speakerphone" width={28} height={28} className="mx-auto opacity-60" />
          <p>Your team hasn't posted any announcements yet.</p>
        </div>
      )}

      {!fetchError && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => {
            const cat = CATEGORY_LABEL[item.category] ?? { label: item.category, color: 'text-default-500 bg-default/20' };
            const isExpanded = expanded.has(item.id);
            return (
              <li
                key={item.id}
                className="rounded-xl border border-divider bg-content1 p-4 space-y-2 cursor-pointer"
                onClick={() => toggle(item.id)}
              >
                <div className="flex items-start gap-2 flex-wrap">
                  {item.pinned && (
                    <Icon icon="tabler:pin-filled" width={14} height={14} className="text-primary mt-0.5 shrink-0" />
                  )}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 ${cat.color}`}>
                    {cat.label}
                  </span>
                  <span className="text-xs text-default-400 ml-auto shrink-0">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="font-semibold text-sm">{item.title}</div>
                <div className={`text-sm text-default-600 whitespace-pre-wrap break-words ${isExpanded ? '' : 'line-clamp-3'}`}>
                  {item.body}
                </div>
                {!isExpanded && item.body.length > 160 && (
                  <div className="text-xs text-primary font-medium">Tap to read more</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// ─── Page 2: My Store ────────────────────────────────────────────────────────

const StorePage = ({ me }: { me: Me }) => {
  const [tab, setTab] = useState<StoreTab>('request');

  return (
    <div>
      {/* Sub-tab bar — sticky inside main scroll container */}
      <div className="flex border-b border-divider bg-content1 sticky top-0 z-10">
        <StoreTabButton active={tab === 'request'} onPress={() => setTab('request')}
          icon="tabler:edit" label="Request" />
        <StoreTabButton active={tab === 'notes'}   onPress={() => setTab('notes')}
          icon="tabler:notebook" label="Notes" />
        <StoreTabButton active={tab === 'reports'} onPress={() => setTab('reports')}
          icon="tabler:file-description" label="Reports" />
      </div>

      {tab === 'request' && <RequestTab me={me} />}
      {tab === 'notes'   && <NotesTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
};

const StoreTabButton = ({
  active, onPress, icon, label,
}: { active: boolean; onPress: () => void; icon: string; label: string }) => (
  <button
    type="button"
    onClick={onPress}
    className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors border-b-2 ${
      active ? 'text-primary border-primary' : 'text-default-500 border-transparent'
    }`}
  >
    <Icon icon={icon} width={18} height={18} />
    {label}
  </button>
);

// ─── Request sub-tab ─────────────────────────────────────────────────────────

type Attachment = { path: string; name: string; type: string; size: number };

const STATUS_LABEL: Record<string, { label: string; color: string; icon: string }> = {
  pending_triage:   { label: 'Triaging',      color: 'text-default-500', icon: 'tabler:loader-2' },
  auto_running:     { label: 'Agent working', color: 'text-primary',     icon: 'tabler:robot' },
  auto_done:        { label: 'Done',          color: 'text-success',     icon: 'tabler:check' },
  needs_assistance: { label: 'Needs review',  color: 'text-warning',     icon: 'tabler:alert-triangle' },
  in_progress:      { label: 'In progress',   color: 'text-secondary',   icon: 'tabler:user' },
  done:             { label: 'Done',          color: 'text-success',     icon: 'tabler:check' },
};

const RequestTab = ({ me }: { me: Me }) => {
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const recorder = useVoiceRecorder();

  const loadRequests = useCallback(() => {
    setLoadingReqs(true);
    api.brandOwner.listMyRequests.query({ limit: 50 })
      .then((r) => setRequests(r as any[]))
      .finally(() => setLoadingReqs(false));
  }, []);

  useEffect(() => { loadRequests(); }, []);

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
      if (bodyRef.current) bodyRef.current.style.height = 'auto';
      setPosted(true);
      setTimeout(() => { setPosted(false); loadRequests(); }, 1500);
    } catch (e: any) {
      setError(e?.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = body.trim().length > 0 || attachments.length > 0;

  return (
    <div>
      {/* Compose section */}
      <div className="px-4 py-4 space-y-3 border-b border-divider">
        {posted ? (
          <div className="py-8 text-center space-y-3">
            <div className="mx-auto inline-flex items-center justify-center size-12 rounded-full bg-success/10 text-success">
              <Icon icon="tabler:check" width={24} height={24} />
            </div>
            <p className="font-medium text-sm">Got it — our team is on it.</p>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-base font-bold">What do you need?</h2>
              <p className="text-xs text-default-500 mt-0.5">
                Copy, design tweaks, questions — add a voice memo, photo, or file.
              </p>
            </div>

            {/* Native textarea: more reliable auto-resize + focus on mobile */}
            <textarea
              ref={bodyRef}
              value={body}
              rows={4}
              placeholder="e.g. 'Update the About page bios…'"
              className={TEXTAREA_CLASS}
              style={{ fontSize: '16px', minHeight: '100px' }}
              onChange={(e) => { setBody(e.target.value); autoResize(e.target); }}
              onFocus={(e) => { autoResize(e.target); scrollIntoView(e.target); }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFile} />
              <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFile} />

              <Button size="sm" variant="flat"
                isDisabled={uploading || recorder.status === 'recording'}
                startContent={<Icon icon="tabler:paperclip" width={14} height={14} />}
                onPress={() => fileInputRef.current?.click()}>
                File
              </Button>
              <Button size="sm" variant="flat"
                isDisabled={uploading || recorder.status === 'recording'}
                startContent={<Icon icon="tabler:camera" width={14} height={14} />}
                onPress={() => imageInputRef.current?.click()}>
                Photo
              </Button>
              {recorder.status === 'recording' ? (
                <Button size="sm" color="danger" variant="flat"
                  startContent={<Icon icon="tabler:player-stop-filled" width={14} height={14} />}
                  onPress={onStopRecording}>
                  Stop · {formatRecorderDuration(recorder.durationMs)}
                </Button>
              ) : (
                <Button size="sm" variant="flat"
                  isDisabled={uploading || recorder.status === 'unsupported'}
                  startContent={<Icon icon="tabler:microphone" width={14} height={14} />}
                  onPress={recorder.start}>
                  Voice
                </Button>
              )}
              {uploading && (
                <span className="text-xs text-default-500 flex items-center gap-1.5">
                  <Spinner size="sm" /> Uploading…
                </span>
              )}
            </div>

            {attachments.length > 0 && (
              <ul className="space-y-1.5">
                {attachments.map((a) => (
                  <li key={a.path}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-divider bg-content2 text-sm">
                    <Icon icon={
                      a.type.startsWith('audio/') ? 'tabler:microphone' :
                      a.type.startsWith('image/') ? 'tabler:photo' : 'tabler:file'
                    } width={14} height={14} className="text-default-500 shrink-0" />
                    <span className="truncate flex-1 text-xs">{a.name}</span>
                    <button type="button"
                      onClick={() => setAttachments((p) => p.filter((x) => x.path !== a.path))}
                      className="text-default-400 hover:text-danger shrink-0 p-1">
                      <Icon icon="tabler:x" width={14} height={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(recorder.error || error) && (
              <div className="rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">
                {recorder.error || error}
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
          </>
        )}
      </div>

      {/* Request list */}
      <div className="px-4 pt-3 pb-4">
        <div className="text-xs font-semibold text-default-500 uppercase tracking-wider mb-3">Your requests</div>
        {loadingReqs ? (
          <div className="py-6 text-center"><Spinner size="sm" /></div>
        ) : requests.length === 0 ? (
          <div className="py-8 text-center text-sm text-default-500 space-y-2">
            <Icon icon="tabler:inbox" width={24} height={24} className="mx-auto opacity-60" />
            <p>No requests yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-divider">
            {requests.map((r) => {
              const meta = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending_triage;
              return (
                <li key={r.id} className="py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon icon={meta.icon} width={13} height={13} className={meta.color} />
                    <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                    <span className="text-xs text-default-400 font-mono tabular-nums ml-auto">#{r.id}</span>
                  </div>
                  <div className="text-sm text-default-700 line-clamp-2 break-words">{r.rawBody}</div>
                  {r.runLogSummary && (
                    <div className="text-xs text-default-500 mt-1 italic line-clamp-2">{r.runLogSummary}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

// ─── Notes sub-tab ───────────────────────────────────────────────────────────

const NotesTab = () => {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brandNotes, setBrandNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  const loadNotes = useCallback(() => {
    setLoading(true);
    api.brandOwner.listMyBrandNotes.query({ limit: 100 })
      .then((r) => setBrandNotes(r as any[]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadNotes(); }, []);

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.brandOwner.addNote.mutate({ content: content.trim() });
      setContent('');
      if (notesRef.current) notesRef.current.style.height = 'auto';
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadNotes();
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-bold">Add a note</h2>
          <p className="text-xs text-default-500 mt-0.5">
            Notes you add here are shared with your team's store view.
          </p>
        </div>

        <textarea
          ref={notesRef}
          value={content}
          rows={3}
          placeholder="Brand context, feedback, preferences…"
          className={TEXTAREA_CLASS}
          style={{ fontSize: '16px', minHeight: '80px' }}
          onChange={(e) => { setContent(e.target.value); autoResize(e.target); }}
          onFocus={(e) => { autoResize(e.target); scrollIntoView(e.target); }}
        />

        {error && (
          <div className="rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">{error}</div>
        )}

        <Button
          size="lg" color="primary" fullWidth
          isLoading={saving}
          isDisabled={!content.trim()}
          onPress={save}
        >
          {saved ? 'Saved!' : 'Save note'}
        </Button>
      </div>

      <div>
        <div className="text-xs font-semibold text-default-500 uppercase tracking-wider mb-3">
          What we know about your brand
        </div>
        {loading ? (
          <div className="py-4 text-center"><Spinner size="sm" /></div>
        ) : brandNotes.length === 0 ? (
          <div className="py-8 text-center text-sm text-default-500 space-y-2">
            <Icon icon="tabler:notebook" width={24} height={24} className="mx-auto opacity-60" />
            <p>Nothing on file yet.</p>
          </div>
        ) : (
          <ul className="space-y-2 pb-4">
            {brandNotes.map((n) => (
              <li key={n.id} className="rounded-xl border border-divider bg-content1 p-3">
                <div className="text-xs text-default-500 mb-1.5 flex items-center gap-2">
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
    </div>
  );
};

// ─── Reports sub-tab ─────────────────────────────────────────────────────────

const ReportsTab = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ name: string; path: string } | null>(null);

  useEffect(() => {
    api.brandOwner.listMyReports.query()
      .then((r) => setReports(r as any[]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center"><Spinner size="sm" /></div>;

  return (
    <div className="px-4 py-4 space-y-3 pb-6">
      <div>
        <h2 className="text-base font-bold">Reports</h2>
        <p className="text-xs text-default-500 mt-0.5">HTML reports and files your team has sent you.</p>
      </div>

      {reports.length === 0 ? (
        <div className="py-12 text-center text-sm text-default-500 space-y-2">
          <Icon icon="tabler:file-description" width={28} height={28} className="mx-auto opacity-60" />
          <p>No reports sent yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setPreview({ name: r.name, path: r.path })}
                className="w-full text-left rounded-xl border border-divider bg-content1 px-4 py-3 flex items-center gap-3 transition-colors"
              >
                <Icon icon="tabler:file-type-html" width={24} height={24} className="text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-xs text-default-400 mt-0.5">
                    {new Date(r.updatedAt).toLocaleDateString()}
                    {r.perfixPath && (
                      <span className="ml-2 opacity-70">· {r.perfixPath.split(',').slice(-1)[0]}</span>
                    )}
                  </div>
                </div>
                <Icon icon="tabler:chevron-right" width={16} height={16} className="text-default-400 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <HtmlPreviewModal
          isOpen
          onClose={() => setPreview(null)}
          fileName={preview.name}
          filePath={preview.path}
        />
      )}
    </div>
  );
};

export default OwnerDashboard;
