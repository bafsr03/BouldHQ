import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Chip } from '@heroui/react';
import Masonry from 'react-masonry-css';
import { Icon } from '@/components/Common/Iconify/icons';
import { ScrollArea } from '@/components/Common/ScrollArea';
import { BlinkoCard } from '@/components/BlinkoCard';
import { BlinkoEditor } from '@/components/BlinkoEditor';
import { LoadingAndEmpty } from '@/components/Common/LoadingAndEmpty';
import { StoreProfileCard } from '@/components/BouldHQ/StoreProfileCard';
import { RequestsPanel } from '@/components/BouldHQ/RequestsPanel';
import { OpsConsole } from '@/components/BouldHQ/OpsConsole';
import { StoreActions } from '@/components/BouldHQ/StoreActions';
import { api } from '@/lib/trpc';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';

// /stores/:tagId — one store's ops view. Team-wide visibility on the notes
// attached to this tag (the notes router broadens the where-clause when the
// caller is a member of the tag's team).

const StoreDetail = observer(() => {
  const { tagId: tagIdParam } = useParams<{ tagId: string }>();
  const tagId = Number(tagIdParam);
  const blinko = RootStore.Get(BlinkoStore);
  blinko.use();
  blinko.useQuery();

  const tag = useMemo(
    () => blinko.tagList.value?.falttenTags?.find((t: any) => t.id === tagId),
    [tagId, blinko.tagList.value],
  );

  const [teamRole, setTeamRole] = useState<'founder' | 'manager' | 'salesman' | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<{ archivedAt: string | null; name: string } | null>(null);
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.team.current.query()
      .then((t) => { if (!cancelled) setTeamRole((t.role as any) ?? null); })
      .catch(() => { if (!cancelled) setTeamRole(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tagId || Number.isNaN(tagId)) return;
    let cancelled = false;
    api.storeProfile.archiveStatus.query({ tagId })
      .then((s) => {
        if (cancelled) return;
        setArchiveStatus({
          archivedAt: s.archivedAt ? new Date(s.archivedAt).toISOString() : null,
          name: s.name,
        });
      })
      .catch(() => { if (!cancelled) setArchiveStatus(null); });
    return () => { cancelled = true; };
  }, [tagId, archiveRefreshKey]);

  const canUseTerminal = teamRole === 'manager' || teamRole === 'founder';
  const isArchived = !!archiveStatus?.archivedAt;
  const displayName = tag?.name ?? archiveStatus?.name ?? `#${tagId}`;

  useEffect(() => {
    if (!tagId || Number.isNaN(tagId)) return;
    blinko.noteListFilterConfig.tagId = tagId;
    blinko.noteListFilterConfig.type = -1;
    blinko.noteListFilterConfig.isArchived = false;
    blinko.noteListFilterConfig.isRecycle = false;
    blinko.noteList.resetAndCall({});
  }, [tagId]);

  const list = blinko.noteList;

  return (
    <ScrollArea
      fixMobileTopBar
      onRefresh={async () => { await list.resetAndCall({}); }}
      onBottom={() => blinko.onBottom()}
      className="h-full bg-background"
    >
      <div className="max-w-screen-xl mx-auto px-4 md:px-8 py-6 md:py-8 space-y-5">

        <nav className="flex items-center gap-1 text-sm text-default-500">
          <Link to="/stores" className="hover:text-foreground transition-colors">Stores</Link>
          <Icon icon="tabler:chevron-right" width={14} height={14} />
          <span className="text-foreground font-medium">{displayName}</span>
        </nav>

        {isArchived && (
          <div className="rounded-md border border-default-200 bg-default-100 text-default-700 px-3 py-2 flex items-center gap-2 text-sm">
            <Icon icon="tabler:archive" width={14} height={14} />
            <span>This store is archived. It's hidden from active lists and the assistant; restore from the actions on the right to bring it back.</span>
          </div>
        )}

        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 border-b border-divider pb-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-default-500">Store ops</div>
            <h1 className={`text-2xl md:text-3xl font-bold ${isArchived ? 'text-default-500' : ''}`}>{displayName}</h1>
          </div>
          <div className="flex items-center gap-2">
            {!isArchived && (
              <Chip size="sm" variant="flat" color="default" startContent={
                <Icon icon="tabler:users" width={12} height={12} />
              }>team-wide notes</Chip>
            )}
            <StoreActions
              tagId={tagId}
              tagName={displayName}
              role={teamRole}
              archivedAt={archiveStatus?.archivedAt ?? null}
              onChanged={() => setArchiveRefreshKey((k) => k + 1)}
            />
          </div>
        </header>

        {tag && <StoreProfileCard tagId={tagId} tagName={tag.name} />}

        {tag && <RequestsPanel tagId={tagId} tagName={tag.name} />}

        {canUseTerminal && tag && <OpsConsole tagId={tagId} tagName={tag.name} />}

        <section aria-label="Store notes" className="space-y-3">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Notes</h2>
            <span className="text-xs text-default-500">
              {list.value?.length ?? 0} note{list.value?.length === 1 ? '' : 's'}
            </span>
          </header>

          {tag && (
            <BlinkoEditor mode="create" key={`create-store-${tagId}`} />
          )}

          <LoadingAndEmpty isLoading={list.isLoading} isEmpty={list.isEmpty} />

          {!list.isEmpty && (
            <Masonry
              breakpointCols={{
                default: blinko.config?.value?.largeDeviceCardColumns ? Number(blinko.config.value.largeDeviceCardColumns) : 2,
                1280: blinko.config?.value?.mediumDeviceCardColumns ? Number(blinko.config.value.mediumDeviceCardColumns) : 2,
                768: blinko.config?.value?.smallDeviceCardColumns ? Number(blinko.config.value.smallDeviceCardColumns) : 1,
              }}
              className="card-masonry-grid"
              columnClassName="card-masonry-grid_column"
            >
              {list.value?.map((n: any) => (
                <BlinkoCard key={n.id} blinkoItem={n} />
              ))}
            </Masonry>
          )}

          {list.isLoadAll && !list.isEmpty && (
            <div className="text-center text-xs text-default-400 py-3">
              All store notes loaded.
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
});

export default StoreDetail;
