import { Icon } from '@/components/Common/Iconify/icons';
import { Chip, Dropdown, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger, Image } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { BaseStore } from '@/store/baseStore';
import { UserStore } from '@/store/user';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { signOut } from '../Auth/auth-client';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { api } from '@/lib/trpc';

interface UserAvatarDropdownProps {
  onItemClick?: () => void;
  collapsed?: boolean;
  showOverlay?: boolean;
}

type Team = { id: number; name: string; slug: string; role: 'founder' | 'manager' | 'salesman' };

const roleColor = (role: Team['role']): any =>
  role === 'founder' ? 'warning' : role === 'manager' ? 'primary' : 'default';

export const UserAvatarDropdown = observer(({ onItemClick, collapsed = false, showOverlay = false }: UserAvatarDropdownProps) => {
  const base = RootStore.Get(BaseStore);
  const user = RootStore.Get(UserStore);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);

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
        setActiveTeamId(current?.id ?? null);
      } catch (err) {
        console.error('avatar team fetch failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const active = teams.find((t) => t.id === activeTeamId) ?? teams[0] ?? null;

  const switchTo = async (teamId: number) => {
    if (teamId === activeTeamId || switching) return;
    setSwitching(true);
    try {
      await api.team.switchActive.mutate({ teamId });
      window.location.reload(); // brute-force refresh team-scoped queries
    } catch (e) {
      console.error('switchActive failed', e);
      setSwitching(false);
    }
  };

  return (
    <Dropdown
      classNames={{
        content: 'bg-secondbackground',
      }}
    >
      <DropdownTrigger>
        <div className={`cursor-pointer ${collapsed ? 'flex justify-center' : 'flex items-center gap-2 w-full'}`}>
          <div className="relative group shrink-0">
            {user.image ? (
              <img src={getBlinkoEndpoint(`${user.image}?token=${user.tokenData.value?.token}`)} alt="avatar" className={`${collapsed ? 'w-10 h-10' : 'w-9 h-9'} rounded-full object-cover transition-all`} />
            ) : (
              <Image src="/logo.png" width={collapsed ? 40 : 36} />
            )}
            <div className={`absolute inset-0 bg-black/30 rounded-full flex items-center justify-center transition-opacity ${showOverlay ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <Icon icon="mdi:cog" width="16" height="16" className="text-white" />
            </div>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm truncate leading-tight">{user.nickname || user.name}</div>
              {active && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-default-500 truncate">{active.name}</span>
                  <Chip size="sm" variant="flat" color={roleColor(active.role)}
                    classNames={{ base: 'h-4 px-1.5', content: 'text-[10px] font-medium leading-none' }}>
                    {active.role}
                  </Chip>
                </div>
              )}
            </div>
          )}
        </div>
      </DropdownTrigger>
      <DropdownMenu aria-label="User and team actions">
        {teams.length > 1 ? (
          <DropdownSection title="Switch team" showDivider>
            {teams.map((tm) => (
              <DropdownItem
                key={`team-${tm.id}`}
                onPress={() => switchTo(tm.id)}
                startContent={
                  <Icon
                    icon={tm.id === activeTeamId ? 'tabler:check' : 'tabler:circle'}
                    width={14} height={14}
                    className={tm.id === activeTeamId ? 'text-success' : 'text-default-300'}
                  />
                }
                endContent={
                  <Chip size="sm" variant="flat" color={roleColor(tm.role)}>{tm.role}</Chip>
                }
              >
                {tm.name}
              </DropdownItem>
            ))}
          </DropdownSection>
        ) : null}

        <DropdownSection>
          {base.routerList
            .filter((i) => i.hiddenSidebar)
            .map((i) => (
              <DropdownItem
                key={i.title}
                className='font-bold'
                startContent={<Icon icon={i.icon} width="20" height="20" />}
                onPress={() => {
                  navigate(i.href);
                  base.currentRouter = i;
                  onItemClick?.();
                }}
              >
                {t(i.title)}
              </DropdownItem>
            ))}

          <DropdownItem
            key="logout"
            className="font-bold text-danger"
            startContent={<Icon icon="hugeicons:logout-05" width="20" height="20" />}
            onPress={async () => {
              await signOut({ callbackUrl: '/signin', redirect: false });
              navigate('/signin');
              onItemClick?.();
            }}
          >
            {t('logout')}
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
});
