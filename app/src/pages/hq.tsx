import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Chip, Skeleton, useDisclosure } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { ScrollArea } from '@/components/Common/ScrollArea';
import { api } from '@/lib/trpc';
import { AnnouncementsPanel, AnnouncementComposer } from '@/components/BouldHQ/AnnouncementsPanel';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

// BouldHQ dashboard — team announcements, stats, and roster.
// Strictly separate from store ops (that lives at /stores).

type Stat = { label: string; value: number | string; icon: string; hint?: string };

type SystemNote = {
  id: number; content: string; kind: string | null;
  isTop: boolean; createdAt: Date | string; updatedAt: Date | string;
};

const HQ = observer(() => {
  const [team, setTeam] = useState<any | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [stats, setStats] = useState<Stat[]>([]);
  const [systemNotes, setSystemNotes] = useState<SystemNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const composer = useDisclosure();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, m, monthly, monthlyStores, openCounts, sysNotes] = await Promise.all([
          api.team.current.query(),
          api.team.members.query({}),
          api.bouldhq.monthlyCheckup.query(),
          api.bouldhq.newStoresThisMonth.query(),
          api.storeRequest.openCountsByTag.query().catch(() => []),
          api.bouldhq.systemNotes.query().catch(() => [] as SystemNote[]),
        ]);
        if (cancelled) return;
        setTeam(t);
        setMembers(m);
        // Heads up: collapse to a single entry per kind so the weekly tracker
        // doesn't stack each week. Sorted-by-newest input → first occurrence wins.
        const seen = new Set<string>();
        const dedupedNotes: SystemNote[] = [];
        for (const n of sysNotes as SystemNote[]) {
          const key = n.kind ?? `id:${n.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          dedupedNotes.push(n);
        }
        setSystemNotes(dedupedNotes);

        const openTotal = openCounts.reduce((acc: number, r: any) => acc + r.count, 0);
        setStats([
          { label: 'Stores managed', value: monthly.total, icon: 'tabler:building-store' },
          { label: 'New this month', value: monthlyStores.count, icon: 'tabler:trending-up' },
          { label: 'Reviewed this month', value: `${monthly.reviewed} / ${monthly.total}`, icon: 'tabler:clipboard-check' },
          { label: 'Open requests', value: openTotal, icon: 'tabler:flame', hint: openTotal > 0 ? 'needs attention' : undefined },
        ]);
      } catch (err) {
        console.error('hq load error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <ScrollArea fixMobileTopBar className="h-full bg-background">
      <div className="max-w-screen-xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-8">

        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-divider pb-6">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-default-500">Team dashboard</div>
            <h1 className="text-3xl md:text-4xl font-bold">
              {team?.name ?? <Skeleton className="w-48 h-9 rounded" />}
            </h1>
            {team && (
              <div className="flex items-center gap-2 text-sm text-default-500">
                <span className="font-mono">{team.slug}</span>
                <span aria-hidden>·</span>
                <Chip size="sm" variant="flat" color={
                  team.role === 'founder' ? 'warning' : team.role === 'manager' ? 'primary' : 'default'
                }>
                  {team.role}
                </Chip>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {team?.role === 'founder' && (
              <Button color="default" variant="flat" onPress={composer.onOpen}
                startContent={<Icon icon="tabler:speakerphone" width={18} height={18} />}>
                Post
              </Button>
            )}
            <Button as={Link} to="/stores" color="primary" variant="flat"
              startContent={<Icon icon="tabler:building-store" width={18} height={18} />}>
              Manage stores
            </Button>
          </div>
        </header>

        {systemNotes.length > 0 && (
          <section aria-label="Heads up" className="rounded-xl border border-divider bg-content1">
            <header className="flex items-center justify-between px-4 py-3 border-b border-divider">
              <div className="flex items-center gap-2">
                <Icon icon="tabler:bell" width={14} height={14} className="text-warning" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Heads up</h2>
              </div>
              <span className="text-xs text-default-500">system-generated · auto-updated</span>
            </header>
            <ul className="divide-y divide-divider">
              {systemNotes.map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="size-7 rounded-md bg-default-100 border border-divider flex items-center justify-center shrink-0">
                      <Icon
                        icon={n.kind === 'weekly_tracker' ? 'tabler:chart-bar' : 'tabler:sparkles'}
                        width={14} height={14}
                        className="text-default-500"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <pre className="text-sm text-default-700 whitespace-pre-wrap break-words font-sans">{n.content}</pre>
                      <div className="text-[10px] text-default-400 font-mono mt-1 tabular-nums">
                        {n.kind ?? 'system'} · updated {new Date(n.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Team metrics">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600 mb-3">Snapshot</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(loading ? Array.from({ length: 4 }).map(() => ({ label: '', value: '', icon: '' } as Stat)) : stats).map((s, i) => {
              const isOpenTile = s.label === 'Open requests' && typeof s.value === 'number' && s.value > 0;
              const className = `rounded-xl border bg-content1 p-4 ${isOpenTile ? 'border-warning/40 hover:border-warning hover:bg-warning/5 transition-colors cursor-pointer' : 'border-divider'}`;
              const inner = loading ? (
                <Skeleton className="w-full h-16 rounded" />
              ) : (
                <>
                  <div className="flex items-center gap-2 text-default-500 text-xs uppercase tracking-wider">
                    <Icon icon={s.icon} width={14} height={14} />
                    {s.label}
                  </div>
                  <div className="mt-2 text-2xl font-bold tabular-nums">{s.value}</div>
                  {s.hint && <div className="mt-1 text-xs text-warning">{s.hint}</div>}
                </>
              );
              return isOpenTile ? (
                <Link key={i} to="/stores?filter=open" className={className}>{inner}</Link>
              ) : (
                <article key={i} className={className}>{inner}</article>
              );
            })}
          </div>
        </section>

        <section aria-label="Team roster" className="rounded-xl border border-divider bg-content1">
          <header className="flex items-center justify-between px-4 py-3 border-b border-divider">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Team roster</h2>
            <span className="text-xs text-default-500 tabular-nums">{members.length} member{members.length === 1 ? '' : 's'}</span>
          </header>
          <ul className="divide-y divide-divider">
            {loading && (
              <li className="px-4 py-3"><Skeleton className="h-10 w-full rounded" /></li>
            )}
            {!loading && members.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-default-500">No members yet.</li>
            )}
            {(() => {
              const token = RootStore.Get(UserStore).tokenData.value?.token;
              const imgUrl = (raw: string) =>
                raw && raw.trim() !== ''
                  ? getBlinkoEndpoint(`${raw}${token ? `?token=${encodeURIComponent(token)}` : ''}`)
                  : '';
              // Display order: founders first, then managers, then salesmen.
              // Within a role, sort by account id ascending so the first founder
              // (you) is #1, the second (JakeK) is #2, etc. The number shown is
              // the position in the list, not the database id.
              const ROLE_ORDER: Record<string, number> = { founder: 0, manager: 1, salesman: 2 };
              const ordered = [...members].sort((a, b) => {
                const ra = ROLE_ORDER[a.role] ?? 99;
                const rb = ROLE_ORDER[b.role] ?? 99;
                if (ra !== rb) return ra - rb;
                return a.account.id - b.account.id;
              });
              return ordered.map((m, idx) => {
                const src = imgUrl(m.account.image);
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="size-9 rounded-full bg-default-200 flex items-center justify-center overflow-hidden">
                      {src ? (
                        <img src={src} alt="" className="size-full object-cover" />
                      ) : (
                        <Icon icon="tabler:user" width={18} height={18} className="text-default-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        <span className="text-default-400 font-mono tabular-nums mr-2">#{idx + 1}</span>
                        {m.account.name}
                      </div>
                      {m.account.nickname && m.account.nickname !== m.account.name && (
                        <div className="text-xs text-default-500 truncate">{m.account.nickname}</div>
                      )}
                    </div>
                    <Chip size="sm" variant="flat" color={
                      m.role === 'founder' ? 'warning' : m.role === 'manager' ? 'primary' : 'default'
                    }>
                      {m.role}
                    </Chip>
                  </li>
                );
              });
            })()}
          </ul>
        </section>

        <AnnouncementsPanel
          category="announcement"
          title="Announcements"
          role={(team?.role as any) ?? null}
          teamId={team?.id ?? null}
          emptyHint="No announcements yet."
          refreshTrigger={refreshKey}
        />

        <AnnouncementsPanel
          category="workflow_update"
          title="Workflow updates"
          role={(team?.role as any) ?? null}
          teamId={team?.id ?? null}
          emptyHint="No workflow changes posted yet."
          refreshTrigger={refreshKey}
        />

        <AnnouncementsPanel
          category="changelog"
          title="What's new in BouldHQ"
          role={(team?.role as any) ?? null}
          teamId={team?.id ?? null}
          emptyHint="No changelog entries yet."
          refreshTrigger={refreshKey}
        />

      </div>

      <AnnouncementComposer
        disclosure={composer}
        role={(team?.role as any) ?? null}
        teamId={team?.id ?? null}
        onPosted={() => setRefreshKey((k) => k + 1)}
      />
    </ScrollArea>
  );
});

export default HQ;
