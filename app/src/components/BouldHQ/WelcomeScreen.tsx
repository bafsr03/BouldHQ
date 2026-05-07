import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { getTemplate, BouldHQTemplateKey } from '@/lib/bouldhq-templates';

const QUICK_LINKS: { key: string; icon: string }[] = [
  { key: 'quick-link-new-client-onboarding', icon: 'mdi:store-plus-outline' },
  { key: 'quick-link-weekly-store-review', icon: 'mdi:calendar-check-outline' },
  { key: 'quick-link-ai-prompt-library', icon: 'mdi:robot-outline' },
  { key: 'quick-link-sops', icon: 'mdi:file-document-outline' },
  { key: 'quick-link-sales-documents', icon: 'mdi:cash-multiple' },
];

const QUICK_ACTIONS: { key: string; template: BouldHQTemplateKey }[] = [
  { key: 'quick-action-new-client-onboarding', template: 'onboarding' },
  { key: 'quick-action-weekly-review', template: 'monthlyReview' },
  { key: 'quick-action-support-request', template: 'support' },
];

export const QuickActionsBar = observer(({ activeClientTag }: { activeClientTag?: string }) => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);

  const fillEditor = (template: BouldHQTemplateKey) => {
    const content = getTemplate(template, activeClientTag);
    blinko.noteContent = content;
    blinko.createContentStorage.save({ content });
  };

  return (
    <div className="flex flex-wrap gap-2 px-2 md:px-6 mt-4 md:mt-6 mb-3">
      {QUICK_ACTIONS.map(({ key, template }) => (
        <Button
          key={key}
          size="sm"
          variant="flat"
          color="default"
          className="bg-default-100 text-default-700 hover:bg-default-200"
          onPress={() => fillEditor(template)}
        >
          {t(key)}
        </Button>
      ))}
    </div>
  );
});

export const WelcomeScreen = observer(({ activeClientTag }: { activeClientTag?: string }) => {
  const { t } = useTranslation();

  return (
    <div className="px-4 md:px-8 py-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">{t('bouldhq-welcome-title')}</h1>
        <p className="text-default-500">{t('bouldhq-tagline')}</p>
      </div>

      <div className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-default-500 mb-3">
          {t('quick-link-sops')} · {t('quick-link-ai-prompt-library')}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {QUICK_LINKS.map(({ key, icon }) => (
            <div
              key={key}
              className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg bg-default-100 hover:bg-default-200 cursor-default text-center"
            >
              <Icon icon={icon} width="24" height="24" className="text-primary" />
              <span className="text-xs font-medium">{t(key)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-default-500 mb-3">
          {t('quick-action-new-client-onboarding').replace(/^\+\s*/, '')}
        </h2>
        <QuickActionsBar activeClientTag={activeClientTag} />
      </div>
    </div>
  );
});
