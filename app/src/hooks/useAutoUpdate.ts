// BouldHQ auto-updater — runs once on app boot.
//
// Hits the GitHub Releases manifest pointed at by tauri.conf.json
// (plugins.updater.endpoints). If a newer signed release exists, prompts the
// user to install. The actual download/install handshake is delegated to the
// existing UpdateProgressDialog if the user accepts.

import { useEffect, useRef } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isInTauri, isDesktop } from '@/lib/tauriHelper';

const BOOT_DELAY_MS = 3_000; // let the app finish booting before nagging

export function useAutoUpdate(onUpdateAvailable?: (version: string) => void) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!isInTauri() || !isDesktop()) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;

        // If the host page wants to render its own UI, hand off.
        if (onUpdateAvailable) {
          onUpdateAvailable(update.version);
          return;
        }

        // Default: ask once, then download + install + relaunch. Native
        // confirm() is fine here — it doesn't depend on any UI being mounted.
        const accept = window.confirm(
          `BouldHQ ${update.version} is available.\n` +
          `Current: ${update.currentVersion}\n\n` +
          `Install and restart now?`,
        );
        if (!accept) return;

        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        // Don't disrupt the user if the manifest is unreachable / unsigned /
        // network is offline. Auto-update is best-effort.
        console.warn('[auto-update] check failed:', err);
      }
    }, BOOT_DELAY_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [onUpdateAvailable]);
}
