import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Switch, Spinner } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

type Profile = {
  storeUrl: string;
  collabAccess: boolean;
  adminUrl: string;
  collaboratorCode: string;
  logoPath: string;
};

const EMPTY: Profile = { storeUrl: '', collabAccess: false, adminUrl: '', collaboratorCode: '', logoPath: '' };

export const StoreProfileCard = observer(({ tagId, tagName }: { tagId: number; tagName: string }) => {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.storeProfile.byTagId.query({ tagId })
      .then(p => {
        if (cancelled) return;
        setProfile(p ? {
          storeUrl: p.storeUrl,
          collabAccess: p.collabAccess,
          adminUrl: p.adminUrl,
          collaboratorCode: p.collaboratorCode,
          logoPath: p.logoPath,
        } : EMPTY);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tagId]);

  const persist = (next: Partial<Profile>) => {
    const merged = { ...profile, ...next };
    setProfile(merged);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.storeProfile.upsert.mutate({
        tagId,
        storeUrl: merged.storeUrl,
        collabAccess: merged.collabAccess,
        adminUrl: merged.adminUrl,
        collaboratorCode: merged.collaboratorCode,
        logoPath: merged.logoPath,
      }).catch(err => console.error('storeProfile.upsert failed', err));
    }, 500);
  };

  const onLogoSelected = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axiosInstance.post(getBlinkoEndpoint('/api/file/upload'), fd);
      const path = res.data?.filePath || res.data?.path;
      if (path) {
        persist({ logoPath: path });
        // BouldHQ: file it under Branding Assets/<tagName>/ in Resources
        api.bouldhq.routeAttachmentByPath.mutate({ path, tagName })
          .catch(err => console.error('routeAttachmentByPath', err));
      }
    } catch (e) {
      console.error('logo upload failed', e);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-2 md:mx-6 mb-3 p-4 bg-default-50 rounded-lg flex items-center gap-2">
        <Spinner size="sm" />
        <span className="text-sm text-default-500">#{tagName}</span>
      </div>
    );
  }

  const token = RootStore.Get(UserStore).tokenData.value?.token;
  const logoUrl = profile.logoPath
    ? getBlinkoEndpoint(`${profile.logoPath}${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    : '';

  return (
    <div className="mx-2 md:mx-6 mb-3 p-4 bg-default-50 rounded-lg">
      <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
        <div
          className="relative w-12 h-12 rounded-md bg-default-200 flex items-center justify-center cursor-pointer overflow-hidden flex-shrink-0"
          onClick={() => fileInputRef.current?.click()}
          title={t('store-profile-store-logo')}
        >
          {uploading ? (
            <Spinner size="sm" />
          ) : logoUrl ? (
            <img src={logoUrl} alt={tagName} className="w-full h-full object-cover" />
          ) : (
            <Icon icon="mdi:storefront-outline" width="24" height="24" className="text-default-500" />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLogoSelected(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className={`flex-1 min-w-0 grid grid-cols-1 ${profile.collabAccess ? '' : 'md:grid-cols-3'} gap-3 w-full`}>
          <div>
            <label className="text-xs text-default-500">{t('store-profile-store-url')}</label>
            <Input
              size="sm"
              value={profile.storeUrl}
              placeholder="storename.myshopify.com"
              onChange={(e) => persist({ storeUrl: e.target.value })}
            />
          </div>
          {!profile.collabAccess && (
            <>
              <div>
                <label className="text-xs text-default-500">{t('store-profile-admin-url')}</label>
                <Input
                  size="sm"
                  value={profile.adminUrl}
                  placeholder="storename.myshopify.com/admin"
                  onChange={(e) => persist({ adminUrl: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-default-500">{t('store-profile-collaborator-code')}</label>
                <Input
                  size="sm"
                  inputMode="numeric"
                  value={profile.collaboratorCode}
                  placeholder="4-digit code"
                  onChange={(e) => persist({ collaboratorCode: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col items-start gap-1 flex-shrink-0">
          <span className="text-xs text-default-500">{t('store-profile-collab-access')}</span>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              isSelected={profile.collabAccess}
              onValueChange={(v) => persist({ collabAccess: v })}
            />
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${profile.collabAccess ? 'bg-success-100 text-success-700' : 'bg-danger-100 text-danger-700'}`}>
              {profile.collabAccess ? `✓ ${t('store-profile-collab-access')}` : `✗ ${t('store-profile-no-access')}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
