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

const CATEGORIES: { value: Category; label: string; icon: string }[] = [
  { value: 'announcement',    label: 'Announcement',  icon: 'tabler:speakerphone' },
  { value: 'workflow_update', label: 'Workflow update', icon: 'tabler:git-branch' },
  { value: 'changelog',       label: 'Changelog',       icon: 'tabler:tag' },
];

const fmt = (d: Date | string) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function AnnouncementsPanel({
  category, title, role, teamId, emptyHint,
}: {
  category: Category | 'all';
  title: string;
  role: Role;
  teamId: number | null;   // null until team.current loads
  emptyHint: string;
}) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const composer = useDisclosure();

  // Only founders can post announcements, workflow updates, or changelog
  // entries. Managers and salesmen are read-only on this panel.
  const canCompose = role === 'founder';

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
    (async () => { await refresh(); if (!cancelled) setLoading(false); })();
    return () => { cancelled = true; };
  }, [category]);

  return (
    <section aria-label={title} className="rounded-xl border border-divider bg-content1">
      <header className="flex items-center justify-between px-4 py-3 border-b border-divider">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">{title}</h2>
        {canCompose && (
          <Button size="sm" variant="flat" color="primary"
            onPress={composer.onOpen}
            startContent={<Icon icon="tabler:plus" width={14} height={14} />}>
            Post
          </Button>
        )}
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

      <Composer
        disclosure={composer}
        defaultCategory={category === 'all' ? 'announcement' : category}
        role={role}
        teamId={teamId}
        onPosted={async () => { composer.onClose(); await refresh(); }}
      />
    </section>
  );
}

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

  // Pin / delete are founder-only operations now.
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
            <button
              type="button" onClick={togglePin} disabled={!!busy}
              className="text-xs text-default-500 hover:text-foreground transition-colors disabled:opacity-50"
            >
              {busy === 'pin' ? 'pinning…' : item.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button" onClick={remove} disabled={!!busy}
              className="text-xs text-danger/80 hover:text-danger transition-colors disabled:opacity-50"
            >
              {busy === 'del' ? 'deleting…' : 'Delete'}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Composer({
  disclosure, defaultCategory, role, teamId, onPosted,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  defaultCategory: Category;
  role: Role;
  teamId: number | null;
  onPosted: () => void | Promise<void>;
}) {
  const [category, setCategory] = useState<Category>(defaultCategory);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<'team' | 'global'>(role === 'founder' ? 'global' : 'team');
  const [pinned, setPinned] = useState(false);
  const [ownersOnly, setOwnersOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setCategory(defaultCategory); }, [defaultCategory]);

  const submit = async () => {
    setSubmitting(true); setError(null);
    try {
      await api.announcement.create.mutate({
        teamId: scope === 'global' ? null : teamId,
        category, title: title.trim(), body: body.trim(), pinned, ownersOnly,
      });
      setTitle(''); setBody(''); setPinned(false);
      await onPosted();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to post');
    } finally { setSubmitting(false); }
  };

  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose} size="2xl">
      <ModalContent>
        <ModalHeader>New post</ModalHeader>
        <ModalBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-default-500">Category</span>
              <Select
                size="sm"
                selectedKeys={[category]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as Category;
                  if (v) setCategory(v);
                }}
              >
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value}>{c.label}</SelectItem>
                ))}
              </Select>
            </label>
            {role === 'founder' && (
              <label className="block">
                <span className="text-xs text-default-500">Scope</span>
                <Select
                  size="sm"
                  selectedKeys={[scope]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as 'team' | 'global';
                    if (v) setScope(v);
                  }}
                >
                  <SelectItem key="global">Global (all teams)</SelectItem>
                  <SelectItem key="team">My active team only</SelectItem>
                </Select>
              </label>
            )}
          </div>
          <label className="block">
            <span className="text-xs text-default-500">Title</span>
            <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline" />
          </label>
          <label className="block">
            <span className="text-xs text-default-500">Body</span>
            <Textarea size="sm" minRows={5} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Markdown-friendly. Keep it brief — pin if it must stick around." />
          </label>
          <label className="flex items-center gap-2 text-xs text-default-700">
            <Switch size="sm" isSelected={pinned} onValueChange={setPinned} />
            Pin to top
          </label>
          {role === 'founder' && (
            <label className="flex items-center gap-2 text-xs text-default-700">
              <Switch size="sm" isSelected={ownersOnly} onValueChange={setOwnersOnly} />
              <span>
                Store owners only
                <span className="text-default-400 ml-1">(hidden from staff feed)</span>
              </span>
            </label>
          )}
          {error && <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">{error}</div>}
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
