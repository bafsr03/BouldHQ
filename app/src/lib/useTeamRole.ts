import { useEffect, useState } from 'react';
import { api } from './trpc';

export type TeamRole = 'founder' | 'manager' | 'salesman';

// Tiny module-level cache so we don't re-fetch on every mount. The role only
// changes when the user switches teams (which currently full-page-reloads via
// window.location.reload in UserAvatarDropdown), so a memory cache is safe.
let cached: TeamRole | null | undefined = undefined;
const subscribers = new Set<(v: TeamRole | null) => void>();

async function load() {
  try {
    const team = await api.team.current.query();
    cached = (team?.role as TeamRole) ?? null;
  } catch {
    cached = null;     // not signed in / no active team
  }
  for (const cb of subscribers) cb(cached!);
}

// Returns `undefined` while loading, then the role or `null` if not in a team.
export function useTeamRole(): TeamRole | null | undefined {
  const [role, setRole] = useState<TeamRole | null | undefined>(cached);

  useEffect(() => {
    if (cached !== undefined) {
      setRole(cached);
      return;
    }
    subscribers.add(setRole);
    if (subscribers.size === 1) load();
    return () => { subscribers.delete(setRole); };
  }, []);

  return role;
}

export function useIsFounder(): boolean {
  return useTeamRole() === 'founder';
}
