import { useState } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

/**
 * Renders a store's logo as a small avatar. Two robustness fixes over a bare
 * <img>:
 *   - requests `?thumbnail=true` so the list fetches a ~500px thumbnail instead
 *     of the full-resolution upload (logos are often multi-MB PNGs shown at
 *     36px), which is far cheaper over the hq.bouldhq.com tunnel and avoids the
 *     burst of large concurrent loads that left rows blank in the desktop app.
 *   - degrades to the store icon on load error instead of the broken-image tile.
 *
 * The parent supplies the sized/rounded box; this just fills it.
 */
export function StoreLogo({
  logoPath,
  alt = '',
  iconSize = 18,
}: {
  logoPath?: string | null;
  alt?: string;
  iconSize?: number;
}) {
  const [failed, setFailed] = useState(false);
  const token = RootStore.Get(UserStore).tokenData.value?.token;

  if (logoPath && !failed) {
    const qs = new URLSearchParams({ thumbnail: 'true' });
    if (token) qs.set('token', token);
    const src = getBlinkoEndpoint(`${logoPath}?${qs.toString()}`);
    return (
      <img
        src={src}
        alt={alt}
        className="size-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <Icon
      icon="tabler:building-store"
      width={iconSize}
      height={iconSize}
      className="text-default-500"
    />
  );
}
