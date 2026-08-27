import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Chip, Skeleton } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { ScrollArea } from '@/components/Common/ScrollArea';
import { StoreLogo } from '@/components/BouldHQ/StoreLogo';
import {
  Collapsible, Count, MONO, Note, RenderBar, StageGate, TaskRow, pct,
} from '@/components/BouldHQ/GrowthBoard';
import { api } from '@/lib/trpc';
import { RootStore } from '@/store';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { useTeamRole } from '@/lib/useTeamRole';
import {
  AGENCY, AGENCY_TASK_TOTAL, BLUEPRINTS, BLUEPRINT_TYPES, BUDGET_GATE_NOTE,
  DTC_MODIFIER_NOTE, MONTHLY, TYPE_DESCRIPTION, TYPE_LABEL,
  type BlueprintType, type GrowthScope,
} from '@shared/lib/growthBlueprints';

// /growth — the Growth Engine accountability tracker.
//
// Two boards sharing one progress number: Bould's own marketing build-out, and
// the phase-gated blueprint we run on each client store. Stores come from the
// real team store list (the same rows as /stores), so a store never has to be
// typed in twice — you put an existing store "on the board" and pick its
// archetype.
//
// Progress is team-scoped and lives server-side (see server/routerTrpc/growth.ts),
// so two people ticking boxes see each other's work on next load. Toggles apply
// optimistically and roll back if the write fails.

type TabKey = 'agency' | 'stores';

type StoreRow = { tagId: number; name: string; logoPath?: string | null };

type Track = { tagId: number; blueprint: BlueprintType; monthStart: string };

/** Key for the flat check set: one entry per ticked box. */
const key = (tagId: number, scope: GrowthScope, taskId: string) => `${tagId}:${scope}:${taskId}`;

const AGENCY_TAG_ID = 0;

const selectClass =
  'bg-content1 border border-divider rounded-lg px-3 py-2 text-sm text-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function GrowthPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = searchParams.get('tab') === 'stores' ? 'stores' : 'agency';
  const teamRole = useTeamRole();
  const isManager = teamRole === 'manager' || teamRole === 'founder';

  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [weekStart, setWeekStart] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);

  // Add-to-board form
  const [pendingTagId, setPendingTagId] = useState('');
  const [pendingType, setPendingType] = useState<BlueprintType>('dtc');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [state, profiles] = await Promise.all([
      api.growth.state.query(),
      api.storeProfile.list.query({ includeArchived: false }),
    ]);
    const next = new Set<string>();
    state.agencyChecks.forEach((id) => next.add(key(AGENCY_TAG_ID, 'agency', id)));
    state.weeklyChecks.forEach((id) => next.add(key(AGENCY_TAG_ID, 'weekly', id)));
    state.tracks.forEach((t) => {
      t.checks.forEach((id) => next.add(key(t.tagId, 'store', id)));
      t.monthly.forEach((id) => next.add(key(t.tagId, 'monthly', id)));
    });
    setChecks(next);
    setWeekStart(state.weekStart);
    setTracks(state.tracks.map((t) => ({ tagId: t.tagId, blueprint: t.blueprint, monthStart: t.monthStart })));
    setStores((profiles as any[]).map((p) => ({ tagId: p.tagId, name: p.tagName, logoPath: p.logoPath })));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (err) {
        console.error('growth load error', err);
        if (!cancelled) RootStore.Get(ToastPlugin).error('Could not load the growth board');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const storeName = useCallback(
    (tagId: number) => stores.find((s) => s.tagId === tagId)?.name ?? `Store #${tagId}`,
    [stores],
  );

  const toggle = useCallback(
    async (tagId: number, scope: GrowthScope, taskId: string, next: boolean) => {
      const k = key(tagId, scope, taskId);
      setChecks((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(k); else copy.delete(k);
        return copy;
      });
      try {
        await api.growth.setCheck.mutate({ tagId, scope, taskId, checked: next });
      } catch (err) {
        // Roll back so the box never claims progress the server didn't record.
        setChecks((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(k); else copy.add(k);
          return copy;
        });
        RootStore.Get(ToastPlugin).error((err as Error)?.message || 'Could not save that check');
      }
    },
    [],
  );

  const countDone = useCallback(
    (tagId: number, scope: GrowthScope, taskIds: string[]) =>
      taskIds.reduce((n, id) => n + (checks.has(key(tagId, scope, id)) ? 1 : 0), 0),
    [checks],
  );

  // Overall = agency one-time tasks + every tracked store's blueprint tasks.
  // The weekly rhythm and the monthly cycle are excluded: they reset, so
  // folding them in would make the headline number sawtooth every Monday.
  const overall = useMemo(() => {
    let done = 0;
    let total = AGENCY_TASK_TOTAL;
    AGENCY.filter((b) => !b.weekly).forEach((b) => {
      done += countDone(AGENCY_TAG_ID, 'agency', b.tasks.map((t) => t.id));
    });
    tracks.forEach((tr) => {
      BLUEPRINTS[tr.blueprint].forEach((phase) => {
        total += phase.tasks.length;
        done += countDone(tr.tagId, 'store', phase.tasks.map((t) => t.id));
      });
    });
    return { done, total };
  }, [checks, tracks, countDone]);

  const startNewWeek = async () => {
    try {
      const res = await api.growth.startNewWeek.mutate();
      setWeekStart(res.weekStart);
      setChecks((prev) => {
        const copy = new Set(prev);
        for (const k of copy) if (k.startsWith(`${AGENCY_TAG_ID}:weekly:`)) copy.delete(k);
        return copy;
      });
    } catch (err) {
      RootStore.Get(ToastPlugin).error((err as Error)?.message || 'Could not start a new week');
    }
  };

  const startNewMonth = async (tagId: number) => {
    try {
      const res = await api.growth.startNewMonth.mutate({ tagId });
      setTracks((prev) => prev.map((t) => (t.tagId === tagId ? { ...t, monthStart: res.monthStart } : t)));
      setChecks((prev) => {
        const copy = new Set(prev);
        for (const k of copy) if (k.startsWith(`${tagId}:monthly:`)) copy.delete(k);
        return copy;
      });
    } catch (err) {
      RootStore.Get(ToastPlugin).error((err as Error)?.message || 'Could not start a new month');
    }
  };

  const addToBoard = async () => {
    const tagId = Number(pendingTagId);
    if (!tagId) return;
    setAdding(true);
    try {
      await api.growth.setBlueprint.mutate({ tagId, blueprint: pendingType });
      setTracks((prev) => [...prev, { tagId, blueprint: pendingType, monthStart: '' }]);
      setPendingTagId('');
    } catch (err) {
      RootStore.Get(ToastPlugin).error((err as Error)?.message || 'Could not add that store');
    } finally {
      setAdding(false);
    }
  };

  const changeBlueprint = async (tagId: number, blueprint: BlueprintType) => {
    const previous = tracks.find((t) => t.tagId === tagId)?.blueprint;
    setTracks((prev) => prev.map((t) => (t.tagId === tagId ? { ...t, blueprint } : t)));
    try {
      await api.growth.setBlueprint.mutate({ tagId, blueprint });
    } catch (err) {
      if (previous) setTracks((prev) => prev.map((t) => (t.tagId === tagId ? { ...t, blueprint: previous } : t)));
      RootStore.Get(ToastPlugin).error((err as Error)?.message || 'Could not change the blueprint');
    }
  };

  const removeFromBoard = async (tagId: number) => {
    if (!window.confirm(`Remove “${storeName(tagId)}” from the growth board? Its progress is deleted.`)) return;
    try {
      await api.growth.untrack.mutate({ tagId });
      setTracks((prev) => prev.filter((t) => t.tagId !== tagId));
      setChecks((prev) => {
        const copy = new Set(prev);
        for (const k of copy) if (k.startsWith(`${tagId}:`)) copy.delete(k);
        return copy;
      });
    } catch (err) {
      RootStore.Get(ToastPlugin).error((err as Error)?.message || 'Could not remove that store');
    }
  };

  const untracked = useMemo(
    () => stores.filter((s) => !tracks.some((t) => t.tagId === s.tagId)),
    [stores, tracks],
  );

  const setTab = (next: TabKey) => {
    if (next === 'agency') searchParams.delete('tab');
    else searchParams.set('tab', next);
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <ScrollArea fixMobileTopBar className="h-full bg-background">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 md:py-10">

        {/* ---------- header ---------- */}
        <header className="border-b border-divider pb-6">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Growth engine</h1>
            <span className={`${MONO} text-default-500`}>Marketing · Accountability tracker</span>
          </div>
          <div className="mt-5">
            <div className={`${MONO} flex justify-between items-baseline text-default-500 mb-2`}>
              <span>Overall — {pct(overall.done, overall.total)}% rendered</span>
              <span className="text-foreground font-medium">{overall.done} / {overall.total} tasks</span>
            </div>
            <RenderBar done={overall.done} total={overall.total} size="lg" />
          </div>
        </header>

        {/* ---------- tabs ---------- */}
        <nav role="tablist" aria-label="Growth board" className="flex gap-2 mt-5">
          {([['agency', 'Bould HQ'], ['stores', 'Client stores']] as const).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`text-sm font-medium px-4.5 py-2 rounded-full border transition-colors ${
                tab === value
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-divider text-default-500 hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {loading ? (
          <div className="space-y-3 mt-5">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : tab === 'agency' ? (
          /* ---------- agency board ---------- */
          <section className="space-y-3.5 mt-5">
            {AGENCY.map((block) => {
              const scope: GrowthScope = block.weekly ? 'weekly' : 'agency';
              const ids = block.tasks.map((t) => t.id);
              const done = countDone(AGENCY_TAG_ID, scope, ids);
              return (
                <Collapsible
                  key={block.id}
                  tag={block.tag}
                  title={block.title}
                  defaultOpen={done < block.tasks.length}
                  progress={{ done, total: block.tasks.length }}
                  meta={block.weekly && weekStart
                    ? <span className="font-mono text-[11px] text-default-500">week of {weekStart}</span>
                    : undefined}
                >
                  {block.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      checked={checks.has(key(AGENCY_TAG_ID, scope, task.id))}
                      onToggle={(next) => toggle(AGENCY_TAG_ID, scope, task.id, next)}
                    />
                  ))}
                  {block.weekly && (
                    <div className="flex items-center gap-3 flex-wrap px-3 pt-2 pb-1">
                      <Button size="sm" variant="flat" onPress={startNewWeek}
                        startContent={<Icon icon="tabler:refresh" width={14} height={14} />}>
                        Start new week
                      </Button>
                      <span className="text-xs text-default-500">
                        Clears the weekly checks and stamps the date. Do it every Monday.
                      </span>
                    </div>
                  )}
                </Collapsible>
              );
            })}
          </section>
        ) : (
          /* ---------- client stores board ---------- */
          <section className="space-y-3.5 mt-5">
            {/* add a store to the board */}
            <div className="flex gap-2.5 flex-wrap items-center p-4 rounded-xl border border-dashed border-divider">
              {untracked.length === 0 ? (
                <span className="text-sm text-default-500">
                  {stores.length === 0
                    ? 'No stores in this team yet — onboard one from Stores first.'
                    : 'Every store in this team is already on the board.'}
                </span>
              ) : (
                <>
                  <select
                    aria-label="Store"
                    className={`${selectClass} flex-1 min-w-[180px]`}
                    value={pendingTagId}
                    onChange={(e) => setPendingTagId(e.target.value)}
                  >
                    <option value="">Choose a store…</option>
                    {untracked.map((s) => <option key={s.tagId} value={s.tagId}>{s.name}</option>)}
                  </select>
                  <select
                    aria-label="Store archetype"
                    className={selectClass}
                    value={pendingType}
                    onChange={(e) => setPendingType(e.target.value as BlueprintType)}
                  >
                    {BLUEPRINT_TYPES.map((k) => <option key={k} value={k}>{TYPE_DESCRIPTION[k]}</option>)}
                  </select>
                  <Button color="primary" onPress={addToBoard} isDisabled={!pendingTagId} isLoading={adding}>
                    Add to board
                  </Button>
                </>
              )}
            </div>

            <Note heading="Budget gate before onboarding:">{BUDGET_GATE_NOTE}</Note>
            <Note heading="DTC modifiers (same blueprint, shifted weights):">{DTC_MODIFIER_NOTE}</Note>

            {tracks.length === 0 && (
              <div className="rounded-xl border border-dashed border-divider py-12 text-center text-sm text-default-500">
                No stores on the board yet. Add one above — each gets its own phase-gated blueprint.
              </div>
            )}

            {tracks.map((track) => {
              const phases = BLUEPRINTS[track.blueprint];
              const total = phases.reduce((n, p) => n + p.tasks.length, 0);
              const done = phases.reduce(
                (n, p) => n + countDone(track.tagId, 'store', p.tasks.map((t) => t.id)), 0,
              );
              const monthlyDone = countDone(track.tagId, 'monthly', MONTHLY.map((t) => t.id));

              return (
                <Collapsible
                  key={track.tagId}
                  title={
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="size-7 rounded-md bg-default-200 flex items-center justify-center overflow-hidden shrink-0">
                        <StoreLogo
                          logoPath={stores.find((s) => s.tagId === track.tagId)?.logoPath}
                          alt={storeName(track.tagId)}
                          iconSize={14}
                        />
                      </span>
                      <span className="truncate">{storeName(track.tagId)}</span>
                    </span>
                  }
                  meta={
                    <Chip size="sm" variant="flat" classNames={{ base: 'h-5', content: `${MONO} px-1` }}>
                      {TYPE_LABEL[track.blueprint]}
                    </Chip>
                  }
                  progress={{ done, total }}
                >
                  {/* phases */}
                  <div className="space-y-2.5 px-2 pt-1.5">
                    {phases.map((phase) => {
                      const pDone = countDone(track.tagId, 'store', phase.tasks.map((t) => t.id));
                      return (
                        <Collapsible
                          key={phase.id}
                          nested
                          tag={phase.tag}
                          title={phase.title}
                          defaultOpen={pDone < phase.tasks.length}
                          progress={{ done: pDone, total: phase.tasks.length }}
                        >
                          {phase.tasks.map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              checked={checks.has(key(track.tagId, 'store', task.id))}
                              onToggle={(next) => toggle(track.tagId, 'store', task.id, next)}
                            />
                          ))}
                          {phase.gate && <StageGate>{phase.gate}</StageGate>}
                        </Collapsible>
                      );
                    })}

                    {/* monthly operating cycle — resets, so excluded from the % above */}
                    <Collapsible
                      nested
                      tag="Monthly"
                      title="Operating cycle"
                      meta={track.monthStart
                        ? <span className="font-mono text-[11px] text-default-500">{track.monthStart}</span>
                        : undefined}
                      progress={{ done: monthlyDone, total: MONTHLY.length }}
                    >
                      {MONTHLY.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          checked={checks.has(key(track.tagId, 'monthly', task.id))}
                          onToggle={(next) => toggle(track.tagId, 'monthly', task.id, next)}
                        />
                      ))}
                      <div className="flex items-center gap-3 flex-wrap px-3 pt-2 pb-1">
                        <Button size="sm" variant="flat" onPress={() => startNewMonth(track.tagId)}
                          startContent={<Icon icon="tabler:refresh" width={14} height={14} />}>
                          Start new month
                        </Button>
                        <span className="text-xs text-default-500">
                          Clears the cycle and stamps the date. Run it the first business day of each month.
                        </span>
                      </div>
                    </Collapsible>
                  </div>

                  {/* per-store actions */}
                  <div className="flex items-center justify-between gap-3 flex-wrap px-4 pt-3.5">
                    <label className="flex items-center gap-2 text-xs text-default-500">
                      Archetype
                      <select
                        aria-label={`Archetype for ${storeName(track.tagId)}`}
                        className={`${selectClass} py-1.5 text-xs`}
                        value={track.blueprint}
                        onChange={(e) => changeBlueprint(track.tagId, e.target.value as BlueprintType)}
                      >
                        {BLUEPRINT_TYPES.map((k) => <option key={k} value={k}>{TYPE_DESCRIPTION[k]}</option>)}
                      </select>
                    </label>
                    {isManager && (
                      <Button size="sm" variant="light" color="danger" onPress={() => removeFromBoard(track.tagId)}>
                        Remove from board
                      </Button>
                    )}
                  </div>
                </Collapsible>
              );
            })}
          </section>
        )}

        <footer className={`${MONO} flex justify-between flex-wrap gap-2 mt-10 pt-4 border-t border-divider text-default-400`}>
          <span>Bould / Growth engine v1</span>
          <span>{loading ? 'loading…' : `${overall.done} of ${overall.total} rendered`}</span>
        </footer>
      </div>
    </ScrollArea>
  );
}
