import { useEffect, useState } from 'react';
import {
  Button, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Select, SelectItem, Switch, Textarea, useDisclosure, Spinner,
} from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

type Category = 'announcement' | 'changelog' | 'workflow_update';

type Announcement = {
  id: number;
  teamId: number | null;
  authorId: number;
  category: Category;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  author: { id: number; name: string; nickname: string; image: string } | null;
};

type Role = 'founder' | 'manager' | 'salesman' | null;

// Scope the user picks in the composer.
// Maps to → { teamId, ownersOnly } on the server.
export type PostScope = 'team' | 'owners' | 'global';

export const SCOPE_OPTIONS: { value: PostScope; label: string; hint: string; icon: string }[] = [
  {
    value: 'team',
    label: 'My team',
    hint: 'Visible to founders, managers & salesmen on your team',
    icon: 'tabler:users',
  },
  {
    value: 'owners',
    label: 'Store owners only',
    hint: 'Visible in brand-owner Feed, hidden from staff',
    icon: 'tabler:building-store',
  },
  {
    value: 'global',
    label: 'Global — all teams',
    hint: 'Broadcast to every team and every store owner',
    icon: 'tabler:world',
  },
];

export const CATEGORIES: { value: Category; label: string; icon: string }[] = [
  { value: 'announcement',    label: 'Announcement',    icon: 'tabler:speakerphone' },
  { value: 'workflow_update', label: 'Workflow update',  icon: 'tabler:git-branch'  },
  { value: 'changelog',       label: 'Changelog',        icon: 'tabler:tag'         },
];

const fmt = (d: Date | string) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ─── Panel (read-only list) ────────────────────────────────────────────────────
// `refreshTrigger` increments from the parent each time a new post lands,
// causing the panel to re-fetch without any other coordination.
export function AnnouncementsPanel({
  category, title, role, teamId, emptyHint, refreshTrigger = 0,
}: {
  category: Category | 'all';
  title: string;
  role: Role;
  teamId: number | null;
  emptyHint: string;
  refreshTrigger?: number;
}) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await api.announcement.list.query({
        ...(category !== 'all' && { category }),
        limit: 30,
      });
      setItems(res as Announcement[]);
    } catch (err) {
      console.error('announcement list failed', err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [category, refreshTrigger]);

  return (
    <section aria-label={title} className="rounded-xl border border-divider bg-content1">
      <header className="flex items-center justify-between px-4 py-3 border-b border-divider">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">{title}</h2>
      </header>

      {loading && (
        <div className="px-4 py-6 text-center"><Spinner size="sm" /></div>
      )}

      {!loading && items.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-default-500">
          <Icon icon="tabler:inbox" width={28} height={28} className="mx-auto mb-2 opacity-60" />
          {emptyHint}
        </div>
      )}

      <ul className="divide-y divide-divider">
        {items.map((a) => (
          <AnnouncementRow key={a.id} item={a} role={role} onChanged={refresh} />
        ))}
      </ul>
    </section>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────
function AnnouncementRow({
  item, role, onChanged,
}: { item: Announcement; role: Role; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);

  const togglePin = async () => {
    setBusy('pin');
    try { await api.announcement.togglePin.mutate({ id: item.id, pinned: !item.pinned }); await onChanged(); }
    catch (e) { console.error(e); } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy('del');
    try { await api.announcement.delete.mutate({ id: item.id }); await onChanged(); }
    catch (e) { console.error(e); } finally { setBusy(null); }
  };

  const isFounder = role === 'founder';
  const catMeta = CATEGORIES.find((c) => c.value === item.category) ?? CATEGORIES[0];

  return (
    <li className="px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {item.pinned && (
          <Chip size="sm" variant="flat" color="warning"
            startContent={<Icon icon="tabler:pin" width={12} height={12} />}>pinned</Chip>
        )}
        <Chip size="sm" variant="flat" color="default"
          startContent={<Icon icon={catMeta.icon} width={12} height={12} />}>{catMeta.label}</Chip>
        {item.teamId === null && (
          <Chip size="sm" variant="flat" color="primary">all teams</Chip>
        )}
        <span className="text-xs text-default-500 ml-auto tabular-nums">{fmt(item.createdAt)}</span>
      </div>

      <h3 className="font-semibold text-sm">{item.title}</h3>
      <p className="text-sm text-default-700 whitespace-pre-wrap break-words">{item.body}</p>

      <div className="flex items-center gap-3 pt-1">
        <span className="text-xs text-default-500">
          by {item.author?.nickname || item.author?.name || '—'}
        </span>
        {isFounder && (
          <>
            <button type="button" onClick={togglePin} disabled={!!busy}
              className="text-xs text-default-500 hover:text-foreground transition-colors disabled:opacity-50">
              {busy === 'pin' ? 'pinning…' : item.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button type="button" onClick={remove} disabled={!!busy}
              className="text-xs text-danger/80 hover:text-danger transition-colors disabled:opacity-50">
              {busy === 'del' ? 'deleting…' : 'Delete'}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ─── Composer (used by hq.tsx, not by each panel) ─────────────────────────────
export function AnnouncementComposer({
  disclosure, role, teamId, onPosted,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  role: Role;
  teamId: number | null;
  onPosted: () => void | Promise<void>;
}) {
  const [category, setCategory] = useState<Category>('announcement');
  const [scope, setScope] = useState<PostScope>('team');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // reset on open
  useEffect(() => {
    if (disclosure.isOpen) {
      setCategory('announcement');
      setScope('team');
      setTitle('');
      setBody('');
      setPinned(false);
      setError(null);
    }
  }, [disclosure.isOpen]);

  const submit = async () => {
    setSubmitting(true); setError(null);
    try {
      const ownersOnly = scope === 'owners';
      const resolvedTeamId = scope === 'global' ? null : teamId;
      await api.announcement.create.mutate({
        teamId: resolvedTeamId,
        category,
        title: title.trim(),
        body: body.trim(),
        pinned,
        ownersOnly,
      });
      await onPosted();
      disclosure.onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to post');
    } finally { setSubmitting(false); }
  };

  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose} size="2xl">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Icon icon="tabler:speakerphone" width={18} height={18} className="text-primary" />
          New post
        </ModalHeader>
        <ModalBody className="space-y-4">

          {/* Category */}
          <label className="block">
            <span className="text-xs text-default-500 mb-1 block">Category</span>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    category === c.value
                      ? 'bg-primary text-white border-primary'
                      : 'bg-content2 border-divider text-default-600 hover:border-primary/40'
                  }`}
                >
                  <Icon icon={c.icon} width={13} height={13} />
                  {c.label}
                </button>
              ))}
            </div>
          </label>

          {/* Scope */}
          <label className="block">
            <span className="text-xs text-default-500 mb-1 block">Who sees this?</span>
            <div className="flex flex-col gap-2">
              {SCOPE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setScope(s.value)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                    scope === s.value
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-content2 border-divider text-default-600 hover:border-primary/20'
                  }`}
                >
                  <div className={`size-7 rounded-lg flex items-center justify-center shrink-0 ${
                    scope === s.value ? 'bg-primary text-white' : 'bg-default-200 text-default-500'
                  }`}>
                    <Icon icon={s.icon} width={14} height={14} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold">{s.label}</div>
                    <div className={`text-[11px] ${scope === s.value ? 'text-primary/70' : 'text-default-400'}`}>{s.hint}</div>
                  </div>
                  {scope === s.value && (
                    <Icon icon="tabler:check" width={14} height={14} className="ml-auto shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </label>

          {/* Title */}
          <label className="block">
            <span className="text-xs text-default-500 mb-1 block">Title</span>
            <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline" />
          </label>

          {/* Body */}
          <label className="block">
            <span className="text-xs text-default-500 mb-1 block">Body</span>
            <Textarea size="sm" minRows={4} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…" />
          </label>

          {/* Pin */}
          <label className="flex items-center gap-2 text-xs text-default-700">
            <Switch size="sm" isSelected={pinned} onValueChange={setPinned} />
            Pin to top
          </label>

          {error && (
            <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">{error}</div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={disclosure.onClose}>Cancel</Button>
          <Button color="primary" isLoading={submitting}
            isDisabled={!title.trim() || !body.trim()} onPress={submit}>
            Post
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
