// iPad onboarding wizard. Salesman walks the new merchant through it in
// person; ends with a magic link they share via iMessage. Optimized for tap
// targets + Safari on iPad. Works fine on phone too.

import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Progress, Spinner } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import { useTeamRole } from '@/lib/useTeamRole';

type Step = 'store' | 'owner' | 'review' | 'share';

const STEPS: Step[] = ['store', 'owner', 'review', 'share'];

const NewStoreWizard = observer(() => {
  const navigate = useNavigate();
  const teamRole = useTeamRole();

  // Form state
  const [step, setStep] = useState<Step>('store');
  const [storeName, setStoreName] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [adminUrl, setAdminUrl] = useState('');
  const [collaboratorCode, setCollaboratorCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');

  // Result + error state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagId, setTagId] = useState<number | null>(null);
  const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);

  if (teamRole === undefined) return <Spinner className="m-8" />;
  if (teamRole === 'salesman' || teamRole === null) {
    return <Forbidden onBack={() => navigate('/stores')} />;
  }

  const stepIndex = STEPS.indexOf(step);
  const canNextStore = storeName.trim().length > 0;
  const canNextOwner = ownerName.trim().length > 0 && /^[^@]+@[^@]+\.[^@]+$/.test(ownerEmail);

  const createStoreAndInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      // Create the store first.
      const created = await api.storeProfile.createStore.mutate({
        name: storeName.trim(),
        storeUrl: storeUrl.trim() || undefined,
        adminUrl: adminUrl.trim() || undefined,
        collaboratorCode: collaboratorCode.trim() || undefined,
      } as any);
      setTagId(created.tagId);

      // Then invite the brand owner; mints the magic link.
      const invite = await api.storeProfile.inviteBrandOwner.mutate({
        tagId: created.tagId,
        email: ownerEmail.trim().toLowerCase(),
        name: ownerName.trim(),
        phone: ownerPhone.trim() || undefined,
      });
      setMagicLinkUrl(invite.magicLinkUrl);
      setStep('share');
    } catch (e: any) {
      setError(e?.message || 'Failed to create store and invite owner');
    } finally {
      setBusy(false);
    }
  };

  const shareViaSms = () => {
    if (!magicLinkUrl) return;
    const body = encodeURIComponent(
      `Hi ${ownerName.split(' ')[0]} — here's your BouldHQ access for ${storeName}. ` +
      `Open this on your phone: ${magicLinkUrl}\n\n` +
      `(Link expires in 15 minutes.)`,
    );
    const number = ownerPhone.replace(/[^0-9+]/g, '');
    // sms: scheme — Apple recognises ?body= on iOS; on macOS Safari it opens Messages.
    const url = number ? `sms:${number}&body=${body}` : `sms:?body=${body}`;
    window.location.href = url;
  };

  const copyLink = async () => {
    if (!magicLinkUrl) return;
    try { await navigator.clipboard.writeText(magicLinkUrl); }
    catch { /* fallback — user can long-press */ }
  };

  return (
    <div className="min-h-screen bg-background flex justify-center">
      <div className="w-full max-w-xl p-4 md:p-8 space-y-4">

        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/stores')}
            className="flex items-center gap-1 text-sm text-default-500 hover:text-default-700"
          >
            <Icon icon="tabler:arrow-left" width={16} height={16} />
            Stores
          </button>
          <span className="text-xs text-default-500 tabular-nums">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </header>

        <Progress
          aria-label="progress"
          value={((stepIndex + 1) / STEPS.length) * 100}
          size="sm"
          color="primary"
        />

        {/* --- Step 1: store basics ---------------------------------------- */}
        {step === 'store' && (
          <section className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold">New brand</h1>
              <p className="text-sm text-default-500 mt-1">
                Start with the store. You can fill in Shopify details now or later.
              </p>
            </div>

            <Field label="Brand name *">
              <Input
                size="lg" autoFocus
                placeholder="e.g. Adophies"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </Field>

            <Field label="Store URL">
              <Input
                size="lg" type="url" inputMode="url"
                placeholder="adophies.com"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
              />
            </Field>

            <Field label="Shopify admin URL">
              <Input
                size="lg" type="url" inputMode="url"
                placeholder="https://admin.shopify.com/store/adophies"
                value={adminUrl}
                onChange={(e) => setAdminUrl(e.target.value)}
              />
            </Field>

            <Field label="Collaborator code">
              <Input
                size="lg" inputMode="numeric"
                placeholder="4-digit code from the merchant"
                value={collaboratorCode}
                onChange={(e) => setCollaboratorCode(e.target.value)}
              />
            </Field>

            <StepButtons
              onBack={() => navigate('/stores')}
              backLabel="Cancel"
              onNext={() => setStep('owner')}
              nextDisabled={!canNextStore}
            />
          </section>
        )}

        {/* --- Step 2: owner contact -------------------------------------- */}
        {step === 'owner' && (
          <section className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold">Who runs {storeName}?</h1>
              <p className="text-sm text-default-500 mt-1">
                They'll get a link to submit requests directly. No password — they tap, they're in.
              </p>
            </div>

            <Field label="Owner full name *">
              <Input
                size="lg" autoFocus
                placeholder="Jane Doe"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </Field>

            <Field label="Owner email *">
              <Input
                size="lg" type="email" inputMode="email" autoComplete="email"
                placeholder="jane@example.com"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
            </Field>

            <Field label="Owner phone">
              <Input
                size="lg" type="tel" inputMode="tel" autoComplete="tel"
                placeholder="(555) 123-4567"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
              />
              <p className="text-xs text-default-500 mt-1">
                Optional. If filled, the iMessage button below pre-fills their number.
              </p>
            </Field>

            <StepButtons
              onBack={() => setStep('store')}
              onNext={() => setStep('review')}
              nextDisabled={!canNextOwner}
            />
          </section>
        )}

        {/* --- Step 3: review -------------------------------------------- */}
        {step === 'review' && (
          <section className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold">Review</h1>
              <p className="text-sm text-default-500 mt-1">
                Last check before we set everything up.
              </p>
            </div>

            <ReviewBlock title="Store">
              <ReviewRow label="Name" value={storeName} />
              <ReviewRow label="URL" value={storeUrl || '—'} />
              <ReviewRow label="Admin URL" value={adminUrl || '—'} />
              <ReviewRow label="Collaborator code" value={collaboratorCode || '—'} />
            </ReviewBlock>

            <ReviewBlock title="Owner">
              <ReviewRow label="Name" value={ownerName} />
              <ReviewRow label="Email" value={ownerEmail} />
              <ReviewRow label="Phone" value={ownerPhone || '—'} />
            </ReviewBlock>

            {error && (
              <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">
                {error}
              </div>
            )}

            <StepButtons
              onBack={() => setStep('owner')}
              onNext={createStoreAndInvite}
              nextLabel={busy ? 'Setting up…' : 'Create + invite'}
              nextDisabled={busy}
            />
          </section>
        )}

        {/* --- Step 4: share --------------------------------------------- */}
        {step === 'share' && magicLinkUrl && (
          <section className="space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-2 inline-flex items-center justify-center size-12 rounded-full bg-success/10 text-success">
                <Icon icon="tabler:check" width={24} height={24} />
              </div>
              <h1 className="text-2xl font-bold">{storeName} is live in BouldHQ</h1>
              <p className="text-sm text-default-500 mt-1">
                Last step: share the access link with {ownerName.split(' ')[0]}.
                Link expires in 15 minutes.
              </p>
            </div>

            <div className="rounded-lg border border-divider bg-content1 p-3 break-all font-mono text-xs">
              {magicLinkUrl}
            </div>

            <Button
              size="lg" color="primary" fullWidth
              startContent={<Icon icon="tabler:brand-messenger" width={18} height={18} />}
              onPress={shareViaSms}
            >
              Send via iMessage
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant="flat" onPress={copyLink}
                startContent={<Icon icon="tabler:copy" width={16} height={16} />}>
                Copy link
              </Button>
              <Button
                size="lg" variant="flat"
                onPress={() => tagId !== null ? navigate(`/stores/${tagId}`) : navigate('/stores')}
                startContent={<Icon icon="tabler:arrow-right" width={16} height={16} />}
              >
                Open store
              </Button>
            </div>

            <p className="text-xs text-default-500 text-center">
              If they don't tap the link in 15 minutes, open this store and click "Resend link".
            </p>
          </section>
        )}
      </div>
    </div>
  );
});

// -- Small inline components --------------------------------------------------

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="block text-sm font-medium text-default-700 mb-1.5">{label}</span>
    {children}
  </label>
);

const StepButtons = ({
  onBack, onNext, backLabel = 'Back', nextLabel = 'Next', nextDisabled = false,
}: {
  onBack: () => void; onNext: () => void;
  backLabel?: string; nextLabel?: string; nextDisabled?: boolean;
}) => (
  <div className="grid grid-cols-2 gap-3 pt-2">
    <Button size="lg" variant="flat" onPress={onBack}>{backLabel}</Button>
    <Button size="lg" color="primary" onPress={onNext} isDisabled={nextDisabled}>
      {nextLabel}
    </Button>
  </div>
);

const ReviewBlock = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-divider bg-content1">
    <header className="px-3 py-2 border-b border-divider text-xs uppercase tracking-wider text-default-500">
      {title}
    </header>
    <dl className="px-3 py-2 space-y-1">{children}</dl>
  </div>
);

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-3 gap-2 text-sm">
    <dt className="text-default-500 col-span-1">{label}</dt>
    <dd className="col-span-2 break-all">{value}</dd>
  </div>
);

const Forbidden = ({ onBack }: { onBack: () => void }) => (
  <div className="min-h-screen flex items-center justify-center p-6">
    <div className="text-center space-y-3">
      <Icon icon="tabler:lock" width={32} height={32} className="mx-auto text-default-400" />
      <p className="text-sm">Only managers and founders can onboard new brands.</p>
      <Button size="sm" variant="flat" onPress={onBack}>Back to stores</Button>
    </div>
  </div>
);

export default NewStoreWizard;
