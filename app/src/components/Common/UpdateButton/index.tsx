import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Tooltip } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { UpdateProgressDialog } from '@/components/Common/UpdateProgressDialog';
import { useUpdateAvailable } from '@/hooks/useAutoUpdate';
import { RootStore } from '@/store';
import { BaseStore } from '@/store/baseStore';

// Sidebar "Update" row, pinned below the nav list. Renders nothing until the
// poller in useAutoUpdate finds a newer signed release, then stays put until
// the user takes it — so nobody has to go to GitHub and install a build by hand.
//
// Deliberately a persistent affordance rather than a prompt: the old behaviour
// was a native confirm() fired once at boot, which was easy to miss, impossible
// to get back to, and never re-fired for a release published while the app was
// already open.
//
// The row's classes are inlined rather than imported from Layout's SideBarItem:
// Layout imports Sidebar, which imports this, so reaching back into Layout would
// close an import cycle.
const ROW = 'p-2 flex flex-row items-center cursor-pointer gap-2 rounded-xl !transition-all';

export const UpdateButton = observer(() => {
  const update = useUpdateAvailable();
  const base = RootStore.Get(BaseStore);
  const [isOpen, setIsOpen] = useState(false);

  if (!update) return null;

  const collapsed = base.isSidebarCollapsed;

  return (
    <>
      <Tooltip
        placement="right"
        content={`Version ${update.version} is available — you're on ${update.currentVersion}`}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsOpen(true); } }}
          className={`${ROW} mt-2 shrink-0 font-semibold bg-primary/10 text-primary hover:bg-primary/20 ${collapsed ? 'justify-center' : ''}`}
        >
          <Icon
            icon="tabler:arrow-big-up-line"
            width={20}
            height={20}
            className={`animate-pulse ${collapsed ? 'mx-auto' : ''}`}
          />
          {!collapsed && <span className="!transition-all">Update to {update.version}</span>}
        </div>
      </Tooltip>

      {/* On success the dialog relaunches into the new build, so there's no
          "installed" state to clear here. If the install fails or the user
          backs out, the row stays for another attempt. */}
      <UpdateProgressDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        newVersion={update.version}
      />
    </>
  );
});
