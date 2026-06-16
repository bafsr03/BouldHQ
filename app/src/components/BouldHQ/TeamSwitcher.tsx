import { useEffect, useState } from 'react';
import { Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

type Team = { id: number; name: string; slug: string; role: 'founder' | 'manager' | 'salesman' };

// Compact team indicator. Renders nothing while loading or for users in 0 teams.
// For a single team, renders a static chip. For >1, renders a dropdown that
// persists the choice via team.switchActive and reloads to refresh team-scoped data.
export function TeamSwitcher({ collapsed }: { collapsed: boolean }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [my, current] = await Promise.all([
          api.team.myTeams.query(),
          api.team.current.query().catch(() => null),
        ]);
        if (cancelled) return;
        setTeams(my as Team[]);
        setActiveId(current?.id ?? null);
      } catch (err) {
        console.error('TeamSwitcher load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (teams.length === 0) return null;

  const active = teams.find((t) => t.id === activeId) ?? teams[0];
  const roleColor: any =
    active.role === 'founder' ? 'warning' : active.role === 'manager' ? 'primary' : 'default';

  if (teams.length === 1) {
    return (
      <div className={`mt-3 ${collapsed ? 'flex justify-center' : ''}`}>
        {collapsed ? (
          <span className="size-7 rounded-md bg-default-100 border border-divider flex items-center justify-center"
            title={`${active.name} · ${active.role}`}>
            <Icon icon="tabler:users-group" width={14} height={14} className="text-default-500" />
          </span>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-divider bg-content1 px-2 py-1.5">
            <Icon icon="tabler:users-group" width={14} height={14} className="text-default-500 shrink-0" />
            <span className="flex-1 min-w-0 text-xs font-medium truncate">{active.name}</span>
            <Chip size="sm" variant="flat" color={roleColor}>{active.role}</Chip>
          </div>
        )}
      </div>
    );
  }

  const switchTo = async (teamId: number) => {
    if (teamId === activeId || busy) return;
    setBusy(true);
    try {
      await api.team.switchActive.mutate({ teamId });
      setActiveId(teamId);
      // Brute-force refresh so every team-scoped query (stores, requests, etc) re-fetches.
      window.location.reload();
    } catch (e) {
      console.error('switchActive failed', e);
      setBusy(false);
    }
  };

  return (
    <div className={`mt-3 ${collapsed ? 'flex justify-center' : ''}`}>
      <Dropdown placement="bottom-start">
        <DropdownTrigger>
          {collapsed ? (
            <button
              type="button"
              className="size-7 rounded-md bg-default-100 border border-divider flex items-center justify-center hover:border-primary"
              title={`Switch team — current: ${active.name}`}
              disabled={busy}
            >
              <Icon icon="tabler:users-group" width={14} height={14} className="text-default-500" />
            </button>
          ) : (
            <button
              type="button"
              className="w-full flex items-center gap-2 rounded-md border border-divider bg-content1 hover:border-primary px-2 py-1.5 transition-colors text-left"
              disabled={busy}
            >
              <Icon icon="tabler:users-group" width={14} height={14} className="text-default-500 shrink-0" />
              <span className="flex-1 min-w-0 text-xs font-medium truncate">{active.name}</span>
              <Chip size="sm" variant="flat" color={roleColor}>{active.role}</Chip>
              <Icon icon="tabler:chevron-down" width={12} height={12} className="text-default-400 shrink-0" />
            </button>
          )}
        </DropdownTrigger>
        <DropdownMenu aria-label="Switch team">
          {teams.map((t) => (
            <DropdownItem
              key={String(t.id)}
              onPress={() => switchTo(t.id)}
              startContent={
                <Icon
                  icon={t.id === activeId ? 'tabler:check' : 'tabler:circle'}
                  width={14} height={14}
                  className={t.id === activeId ? 'text-success' : 'text-default-300'}
                />
              }
              endContent={
                <Chip size="sm" variant="flat" color={
                  t.role === 'founder' ? 'warning' : t.role === 'manager' ? 'primary' : 'default'
                }>{t.role}</Chip>
              }
            >
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-[10px] text-default-500 font-mono">{t.slug}</div>
            </DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}
