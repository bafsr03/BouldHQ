import { observer } from 'mobx-react-lite';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Chip, Input, Select, SelectItem, Switch, Textarea, RadioGroup, Radio, Spinner,
} from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { ScrollArea } from '@/components/Common/ScrollArea';
import { api } from '@/lib/trpc';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

// /stores/new — 4-step onboarding wizard.
// Salesman walks the store owner's info into structured fields, then a single
// transactional mutation creates the tag + storeProfile + branding folder + first request.

const SHOPIFY_PLANS = ['', 'Starter', 'Basic', 'Shopify', 'Advanced', 'Plus'] as const;
const STEPS = ['Identity', 'Shopify access', 'Requirements', 'Review'] as const;
type Step = 0 | 1 | 2 | 3;

type FormState = {
  name: string;
  logoPath: string;

  storeUrl: string;
  collabAccess: boolean;
  shopifyPlan: typeof SHOPIFY_PLANS[number];
  adminUrl: string;
  collaboratorCode: string;
  renewalDate: string; // yyyy-mm-dd

  reqSource: 'text' | 'email' | 'screenshot' | 'voice';
  reqBody: string;
  reqInclude: boolean;
};

const EMPTY: FormState = {
  name: '',
  logoPath: '',
  storeUrl: '',
  collabAccess: false,
  shopifyPlan: '',
  adminUrl: '',
  collaboratorCode: '',
  renewalDate: '',
  reqSource: 'text',
  reqBody: '',
  reqInclude: true,
};

const NewStoreWizard = observer(() => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const token = RootStore.Get(UserStore).tokenData.value?.token;
  const logoUrl = form.logoPath
    ? getBlinkoEndpoint(`${form.logoPath}${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    : '';

  const stepValid = useMemo(() => {
    switch (step) {
      case 0: return form.name.trim().length > 0 && !/[\s#/]/.test(form.name);
      case 1: return true; // all step-1 fields are optional
      case 2: return !form.reqInclude || form.reqBody.trim().length > 0;
      case 3: return true;
      default: return false;
    }
  }, [step, form]);

  const onLogoSelected = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axiosInstance.post(getBlinkoEndpoint('/api/file/upload'), fd);
      const path = res.data?.filePath || res.data?.path;
      if (path) set('logoPath', path);
    } catch (e: any) {
      setError(`Logo upload failed: ${e?.message || 'unknown'}`);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.storeProfile.createStore.mutate({
        name: form.name.trim(),
        storeUrl: form.storeUrl.trim(),
        collabAccess: form.collabAccess,
        shopifyPlan: form.shopifyPlan,
        adminUrl: form.adminUrl.trim(),
        collaboratorCode: form.collaboratorCode.trim(),
        logoPath: form.logoPath,
        renewalDate: form.renewalDate ? new Date(form.renewalDate) : null,
        initialRequest: form.reqInclude && form.reqBody.trim()
          ? { source: form.reqSource, rawBody: form.reqBody.trim() }
          : undefined,
      });
      // BouldHQ: file the logo under Branding Assets/<name>/ in Resources.
      if (form.logoPath) {
        api.bouldhq.routeAttachmentByPath
          .mutate({ path: form.logoPath, tagName: form.name.trim() })
          .catch((e: any) => console.error('routeAttachmentByPath', e));
      }
      navigate(`/stores/${result.tagId}`);
    } catch (e: any) {
      setError(e?.message || 'Failed to create store');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollArea fixMobileTopBar className="h-full bg-background">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-6">

        <nav className="flex items-center gap-1 text-sm text-default-500">
          <Link to="/stores" className="hover:text-foreground transition-colors">Stores</Link>
          <Icon icon="tabler:chevron-right" width={14} height={14} />
          <span className="text-foreground font-medium">New store</span>
        </nav>

        <header className="border-b border-divider pb-4">
          <div className="text-xs uppercase tracking-wider text-default-500">Onboarding</div>
          <h1 className="text-2xl md:text-3xl font-bold">Add a new store</h1>
          <p className="text-sm text-default-500 mt-1">
            Walk through the four steps below. Required field is the store name; everything else can be filled in later from the store's ops page.
          </p>
        </header>

        <ol className="grid grid-cols-4 gap-2" aria-label="Wizard steps">
          {STEPS.map((label, i) => {
            const isActive = i === step;
            const isDone = i < step;
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => i <= step && setStep(i as Step)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    isActive ? 'border-primary bg-primary/10' :
                    isDone ? 'border-success/40 bg-success/5 hover:bg-success/10 cursor-pointer' :
                    'border-divider opacity-50 cursor-not-allowed'
                  }`}
                  disabled={i > step}
                >
                  <div className="flex items-center gap-2">
                    <span className={`size-5 rounded-full text-xs font-bold tabular-nums flex items-center justify-center ${
                      isActive ? 'bg-primary text-primary-foreground' :
                      isDone ? 'bg-success text-success-foreground' :
                      'bg-default-200 text-default-500'
                    }`}>
                      {isDone ? <Icon icon="tabler:check" width={12} height={12} /> : i + 1}
                    </span>
                    <span className="text-xs uppercase tracking-wider truncate">{label}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>

        <section className="rounded-xl border border-divider bg-content1 p-4 md:p-6 space-y-4">
          {step === 0 && (
            <>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Store identity</h2>

              <label className="block">
                <span className="text-xs text-default-500">Store name (required)</span>
                <Input
                  size="sm"
                  value={form.name}
                  placeholder="acme"
                  onChange={(e) => set('name', e.target.value)}
                  description="Becomes the team-wide tag. No spaces, #, or /. Used in #hashtags."
                />
              </label>

              <div className="flex items-center gap-4">
                <div
                  className="size-16 rounded-md bg-default-100 border border-divider flex items-center justify-center cursor-pointer overflow-hidden"
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload logo"
                >
                  {uploading ? (
                    <Spinner size="sm" />
                  ) : logoUrl ? (
                    <img src={logoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Icon icon="tabler:photo-plus" width={22} height={22} className="text-default-400" />
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
                <div className="text-xs text-default-500">
                  <div className="font-medium text-default-700">Logo (optional)</div>
                  <div>Auto-filed under <code className="font-mono">Branding Assets/{form.name || '…'}/</code> in Resources.</div>
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Shopify access</h2>

              <label className="block">
                <span className="text-xs text-default-500">Shopify store URL</span>
                <Input
                  size="sm"
                  value={form.storeUrl}
                  placeholder="acme.myshopify.com"
                  onChange={(e) => set('storeUrl', e.target.value)}
                />
              </label>

              <div className="rounded-lg border border-divider p-3 flex items-start gap-3">
                <Switch
                  size="sm"
                  isSelected={form.collabAccess}
                  onValueChange={(v) => set('collabAccess', v)}
                />
                <div className="text-xs">
                  <div className="font-medium text-default-700">Already have collaborator access</div>
                  <div className="text-default-500">Toggle on if the store owner has already added you as a collaborator in Shopify Admin.</div>
                </div>
              </div>

              {!form.collabAccess && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-default-500">Admin URL</span>
                    <Input
                      size="sm"
                      value={form.adminUrl}
                      placeholder="acme.myshopify.com/admin"
                      onChange={(e) => set('adminUrl', e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-default-500">Collaborator request code</span>
                    <Input
                      size="sm"
                      inputMode="numeric"
                      value={form.collaboratorCode}
                      placeholder="4-digit code"
                      onChange={(e) => set('collaboratorCode', e.target.value.replace(/\D/g, '').slice(0, 8))}
                    />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-default-500">Plan</span>
                  <Select
                    size="sm"
                    selectedKeys={form.shopifyPlan ? [form.shopifyPlan] : []}
                    onSelectionChange={(keys) => {
                      const v = (Array.from(keys)[0] as typeof SHOPIFY_PLANS[number]) ?? '';
                      set('shopifyPlan', v);
                    }}
                  >
                    {SHOPIFY_PLANS.filter((p) => p).map((p) => (
                      <SelectItem key={p}>{p}</SelectItem>
                    ))}
                  </Select>
                </label>
                <label className="block">
                  <span className="text-xs text-default-500">Renewal date</span>
                  <Input
                    type="date"
                    size="sm"
                    value={form.renewalDate}
                    onChange={(e) => set('renewalDate', e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Initial requirements</h2>

              <div className="rounded-lg border border-divider p-3 flex items-start gap-3">
                <Switch
                  size="sm"
                  isSelected={form.reqInclude}
                  onValueChange={(v) => set('reqInclude', v)}
                />
                <div className="text-xs">
                  <div className="font-medium text-default-700">Open the first request now</div>
                  <div className="text-default-500">Logs the store owner's first message as a <span className="font-mono">pending_triage</span> request. AI triage runs in Phase 3.</div>
                </div>
              </div>

              {form.reqInclude && (
                <>
                  <label className="block">
                    <span className="text-xs text-default-500">Source</span>
                    <RadioGroup
                      orientation="horizontal"
                      size="sm"
                      value={form.reqSource}
                      onValueChange={(v) => set('reqSource', v as FormState['reqSource'])}
                    >
                      <Radio value="text">Text/chat</Radio>
                      <Radio value="email">Email</Radio>
                      <Radio value="screenshot">Screenshot</Radio>
                      <Radio value="voice">Voice memo</Radio>
                    </RadioGroup>
                  </label>

                  <label className="block">
                    <span className="text-xs text-default-500">Raw message</span>
                    <Textarea
                      size="sm"
                      minRows={6}
                      value={form.reqBody}
                      placeholder="Paste the store owner's email / text / transcribed voice memo / screenshot OCR here. Don't rewrite — paste verbatim so the AI can triage on the original wording."
                      onChange={(e) => set('reqBody', e.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Review</h2>
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                <dt className="text-default-500">Name</dt>
                <dd className="col-span-2 font-medium">{form.name || <em className="text-default-400">missing</em>}</dd>

                <dt className="text-default-500">Logo</dt>
                <dd className="col-span-2">
                  {form.logoPath ? <Chip size="sm" variant="flat" color="success">uploaded</Chip> : <em className="text-default-400">none</em>}
                </dd>

                <dt className="text-default-500">Store URL</dt>
                <dd className="col-span-2 font-mono">{form.storeUrl || <em className="text-default-400">—</em>}</dd>

                <dt className="text-default-500">Access</dt>
                <dd className="col-span-2">
                  {form.collabAccess
                    ? <Chip size="sm" variant="flat" color="success">collaborator</Chip>
                    : <span>code <span className="font-mono">{form.collaboratorCode || '—'}</span> · admin <span className="font-mono">{form.adminUrl || '—'}</span></span>}
                </dd>

                <dt className="text-default-500">Plan</dt>
                <dd className="col-span-2">{form.shopifyPlan || <em className="text-default-400">—</em>}</dd>

                <dt className="text-default-500">Renewal</dt>
                <dd className="col-span-2 font-mono">{form.renewalDate || <em className="text-default-400">—</em>}</dd>

                <dt className="text-default-500">First request</dt>
                <dd className="col-span-2">
                  {form.reqInclude && form.reqBody.trim()
                    ? <span><Chip size="sm" variant="flat" color="warning">{form.reqSource}</Chip> <span className="text-default-500 text-xs">{form.reqBody.length} chars</span></span>
                    : <em className="text-default-400">none</em>}
                </dd>
              </dl>
            </>
          )}

          {error && (
            <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">
              {error}
            </div>
          )}
        </section>

        <footer className="flex items-center justify-between">
          <Button
            variant="light"
            isDisabled={step === 0 || submitting}
            onPress={() => setStep((s) => (s - 1) as Step)}
            startContent={<Icon icon="tabler:chevron-left" width={16} height={16} />}
          >
            Back
          </Button>
          {step < 3 ? (
            <Button
              color="primary"
              isDisabled={!stepValid}
              onPress={() => setStep((s) => (s + 1) as Step)}
              endContent={<Icon icon="tabler:chevron-right" width={16} height={16} />}
            >
              Continue
            </Button>
          ) : (
            <Button
              color="primary"
              isLoading={submitting}
              isDisabled={!form.name.trim()}
              onPress={submit}
              startContent={!submitting && <Icon icon="tabler:building-store" width={16} height={16} />}
            >
              Create store
            </Button>
          )}
        </footer>
      </div>
    </ScrollArea>
  );
});

export default NewStoreWizard;
