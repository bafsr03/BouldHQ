import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Chip, Input, Skeleton } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { ScrollArea } from '@/components/Common/ScrollArea';
import { api } from '@/lib/trpc';
import { StoreLogo } from '@/components/BouldHQ/StoreLogo';

// /stores — team-scoped list of stores (every top-level tag in the active team).
// One row per store; click to drill into ops at /stores/:tagId.

type StoreRow = {
  tagId: number;
  name: string;
  profile: any;
  openRequests: number;
  archivedAt: string | null;
};

const StoresList = observer(() => {
  const [searchParams, setSearchParams] = useSearchParams();
  const onlyOpen = searchParams.get('filter') === 'open';
  const showArchived = searchParams.get('archived') === '1';
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [profiles, openCounts] = await Promise.all([
          api.storeProfile.list.query({ includeArchived: showArchived }),
          api.storeRequest.openCountsByTag.query().catch(() => []),
        ]);
        if (cancelled) return;

        const openByTagId = new Map((openCounts as any[]).map((c) => [c.tagId, c.count]));

        const next: StoreRow[] = (profiles as any[]).map((p) => ({
          tagId: p.tagId,
          name: p.tagName,
          profile: p,
          openRequests: openByTagId.get(p.tagId) ?? 0,
          archivedAt: p.archivedAt ? new Date(p.archivedAt).toISOString() : null,
        }));
        // Active first; within each group, open-requests then alpha.
        next.sort((a, b) => {
          const aArch = a.archivedAt ? 1 : 0;
          const bArch = b.archivedAt ? 1 : 0;
          if (aArch !== bArch) return aArch - bArch;
          return b.openRequests - a.openRequests || a.name.localeCompare(b.name);
        });
        setRows(next);
      } catch (err) {
        console.error('stores load error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showArchived]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (onlyOpen) out = out.filter((r) => r.openRequests > 0);
    if (q) out = out.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.profile?.storeUrl ?? '').toLowerCase().includes(q),
    );
    return out;
  }, [rows, search, onlyOpen]);

  return (
    <ScrollArea fixMobileTopBar className="h-full bg-background">
      <div className="max-w-screen-xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-6">

        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-divider pb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-default-500">Store ops</div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl md:text-4xl font-bold">Stores</h1>
              {onlyOpen && (
                <Chip
                  size="sm" variant="flat" color="warning"
                  onClose={() => { searchParams.delete('filter'); setSearchParams(searchParams, { replace: true }); }}
                  startContent={<Icon icon="tabler:flame" width={12} height={12} />}
                >
                  open requests only
                </Chip>
              )}
            </div>
            <p className="text-sm text-default-500 mt-1">
              {onlyOpen
                ? 'Showing only stores with open requests.'
                : 'Every Shopify store your team manages. Click a store to view its ops, requests, and notes.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              size="sm"
              placeholder="Search by name or URL"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              startContent={<Icon icon="tabler:search" width={16} height={16} className="text-default-400" />}
              className="md:w-72"
            />
            <button
              type="button"
              onClick={() => {
                if (showArchived) searchParams.delete('archived');
                else searchParams.set('archived', '1');
                setSearchParams(searchParams, { replace: true });
              }}
              className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                showArchived
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-divider text-default-600 hover:bg-default-100'
              }`}
            >
              <Icon icon="tabler:archive" width={12} height={12} className="inline mr-1 -mt-0.5" />
              {showArchived ? 'Hiding active only' : 'Show archived'}
            </button>
            <Button as={Link} to="/stores/new" color="primary" variant="flat"
              startContent={<Icon icon="tabler:plus" width={16} height={16} />}>
              New store
            </Button>
          </div>
        </header>

        <section aria-label="Store list" className="rounded-xl border border-divider bg-content1 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wider text-default-500 border-b border-divider">
            <div className="col-span-5 md:col-span-4">Store</div>
            <div className="col-span-4 md:col-span-3 hidden md:block">Shopify URL</div>
            <div className="col-span-3 md:col-span-2">Collab</div>
            <div className="col-span-4 md:col-span-2 text-right">Requests</div>
            <div className="hidden md:block md:col-span-1"></div>
          </div>

          {loading && (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded" />
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="px-4 py-16 text-center text-sm text-default-500">
              <Icon icon="tabler:building-store-off" width={32} height={32} className="mx-auto mb-2 opacity-60" />
              {search ? `No stores match "${search}".` : 'No stores yet. Use “New store” to onboard one.'}
            </div>
          )}

          <ul className="divide-y divide-divider">
            {filtered.map((r) => (
              <li key={r.tagId}>
                <Link
                  to={`/stores/${r.tagId}`}
                  className={`grid grid-cols-12 gap-2 items-center px-4 py-3 hover:bg-default-100 transition-colors ${r.archivedAt ? 'opacity-60' : ''}`}
                >
                  <div className="col-span-5 md:col-span-4 flex items-center gap-3 min-w-0">
                    <div className="size-9 rounded-md bg-default-200 flex items-center justify-center overflow-hidden shrink-0">
                      <StoreLogo logoPath={r.profile?.logoPath} alt={r.name} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{r.name}</span>
                        {r.archivedAt && (
                          <Chip size="sm" variant="flat" color="default"
                            classNames={{ base: 'h-4 px-1.5', content: 'text-[10px] font-medium leading-none' }}>
                            archived
                          </Chip>
                        )}
                      </div>
                      <div className="text-xs text-default-500 font-mono truncate md:hidden">
                        {r.profile?.storeUrl || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="col-span-4 md:col-span-3 hidden md:block">
                    <span className="text-sm font-mono text-default-600 truncate block">
                      {r.profile?.storeUrl || <span className="text-default-400">—</span>}
                    </span>
                  </div>

                  <div className="col-span-3 md:col-span-2">
                    {r.profile?.collabAccess ? (
                      <Chip size="sm" variant="flat" color="success" startContent={
                        <Icon icon="tabler:check" width={12} height={12} />
                      }>access</Chip>
                    ) : (
                      <Chip size="sm" variant="flat" color="default">code</Chip>
                    )}
                  </div>

                  <div className="col-span-4 md:col-span-2 text-right tabular-nums">
                    {r.openRequests > 0 ? (
                      <Chip size="sm" variant="flat" color="warning"
                        startContent={<Icon icon="tabler:flame" width={12} height={12} />}>
                        {r.openRequests} open
                      </Chip>
                    ) : (
                      <span className="text-xs text-default-400">none</span>
                    )}
                  </div>

                  <div className="hidden md:flex md:col-span-1 justify-end">
                    <Icon icon="tabler:chevron-right" width={16} height={16} className="text-default-400" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </ScrollArea>
  );
});

export default StoresList;
