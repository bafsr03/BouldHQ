// BouldHQ auto-updater.
//
// Hits the GitHub Releases manifest pointed at by tauri.conf.json
// (plugins.updater.endpoints). When a newer signed release exists, the result
// is published to every subscriber so the header can show an Update button —
// see components/Common/UpdateButton. The download/install handshake itself is
// handled by UpdateProgressDialog.
//
// Previously this prompted with a native confirm() once at boot. Two problems:
// a release published while the app was already open was never noticed until
// the next restart, and dismissing the prompt left no way back to it. State
// lives at module level so the poller runs once no matter how many components
// read from it.

import { useEffect, useRef, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { isInTauri, isDesktop } from '@/lib/tauriHelper';

export type AvailableUpdate = {
  version: string;
  currentVersion: string;
};

const BOOT_DELAY_MS = 3_000;      // let the app finish booting before checking
const POLL_INTERVAL_MS = 30 * 60_000;  // re-check every 30 minutes
const FOCUS_THROTTLE_MS = 5 * 60_000;  // ...and on refocus, at most this often

let available: AvailableUpdate | null = null;
let lastCheckedAt = 0;
let pollerStarted = false;
const subscribers = new Set<(u: AvailableUpdate | null) => void>();

function publish(update: AvailableUpdate | null) {
  available = update;
  for (const notify of subscribers) notify(update);
}

async function runCheck() {
  if (!isInTauri() || !isDesktop()) return;
  lastCheckedAt = Date.now();
  try {
    const update = await check();
    publish(update ? { version: update.version, currentVersion: update.currentVersion } : null);
  } catch (err) {
    // Best-effort: an unreachable manifest, an unsigned build, or being offline
    // must not disrupt the user. Leave any previously-found update in place.
    console.warn('[auto-update] check failed:', err);
  }
}

/**
 * Starts the update poller. Call once, high in the tree — extra calls are
 * ignored. Rendering the button is `useUpdateAvailable`'s job.
 */
export function useAutoUpdate() {
  useEffect(() => {
    if (pollerStarted) return;
    if (!isInTauri() || !isDesktop()) return;
    pollerStarted = true;

    const boot = setTimeout(runCheck, BOOT_DELAY_MS);
    const interval = setInterval(runCheck, POLL_INTERVAL_MS);

    // Catch releases published while the app sat in the background. Closing the
    // window only hides it on macOS, so refocus is often the first signal we
    // get that the user is back.
    const onFocus = () => {
      if (available) return; // already know; nothing to re-check
      if (Date.now() - lastCheckedAt < FOCUS_THROTTLE_MS) return;
      runCheck();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      clearTimeout(boot);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      pollerStarted = false;
    };
  }, []);
}

/** The pending update, or null. Re-renders when the poller finds one. */
export function useUpdateAvailable(): AvailableUpdate | null {
  const [update, setUpdate] = useState<AvailableUpdate | null>(available);
  const ref = useRef(setUpdate);
  ref.current = setUpdate;

  useEffect(() => {
    const notify = (u: AvailableUpdate | null) => ref.current(u);
    subscribers.add(notify);
    return () => { subscribers.delete(notify); };
  }, []);

  return update;
}
