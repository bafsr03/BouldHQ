import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

export const AnalyticsCounters = observer(() => {
  const { t } = useTranslation();
  const [checkup, setCheckup] = useState<{ reviewed: number; total: number }>({ reviewed: 0, total: 0 });
  const [newStores, setNewStores] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.bouldhq.monthlyCheckup.query(),
      api.bouldhq.newStoresThisMonth.query(),
    ])
      .then(([c, n]) => {
        if (cancelled) return;
        setCheckup(c);
        setNewStores(n.count);
      })
      .catch(err => console.error('AnalyticsCounters', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="p-4 bg-default-50 rounded-lg flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-primary-100 text-primary flex items-center justify-center">
          <Icon icon="mdi:calendar-check-outline" width="20" height="20" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-default-500">{t('monthly-checkup')}</div>
          <div className="text-xl font-semibold tabular-nums">
            {loading ? '—' : `${checkup.reviewed} / ${checkup.total}`}
          </div>
          <div className="text-xs text-default-400">{t('monthly-checkup-desc')}</div>
        </div>
      </div>

      <div className="p-4 bg-default-50 rounded-lg flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-success-100 text-success flex items-center justify-center">
          <Icon icon="mdi:storefront-plus-outline" width="20" height="20" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-default-500">{t('new-stores')}</div>
          <div className="text-xl font-semibold tabular-nums">
            {loading ? '—' : newStores === 0 ? '🥯' : newStores}
          </div>
          <div className="text-xs text-default-400">{t('new-stores-desc')}</div>
        </div>
      </div>
    </div>
  );
});
