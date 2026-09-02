import { useState } from 'react';
import { Button, Tooltip } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { UpdateProgressDialog } from '@/components/Common/UpdateProgressDialog';
import { useUpdateAvailable } from '@/hooks/useAutoUpdate';

/**
 * Top-bar "Update" button. Renders nothing until the poller in useAutoUpdate
 * finds a newer signed release, then sits in the header until the user takes
 * it — so nobody has to go to GitHub and download a build by hand.
 *
 * Deliberately a persistent affordance rather than a modal: a prompt fired once
 * at boot is easy to dismiss and impossible to get back to.
 */
export const UpdateButton = () => {
  const update = useUpdateAvailable();
  const [isOpen, setIsOpen] = useState(false);

  if (!update) return null;

  return (
    <>
      <Tooltip content={`Version ${update.version} is available — you're on ${update.currentVersion}`}>
        <Button
          size="sm"
          color="primary"
          variant="flat"
          className="shrink-0 animate-pulse"
          startContent={<Icon icon="tabler:arrow-big-up-line" width={16} height={16} />}
          onPress={() => setIsOpen(true)}
        >
          Update
        </Button>
      </Tooltip>

      {/* On success the dialog relaunches into the new build, so there's no
          "installed" state to clean up here. If the user backs out or the
          install fails, the button stays for another attempt. */}
      <UpdateProgressDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        newVersion={update.version}
      />
    </>
  );
};
