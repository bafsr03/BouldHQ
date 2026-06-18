// Brand-owner login — dark full-bleed background with logo + bottom-sheet card.
// Two modes:
//   1. ?token=… — magic link exchange → 30-day JWT
//   2. no token  — username / password form

import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';

type ExchangeStatus = 'exchanging' | 'success' | 'invalid' | 'expired' | 'used' | 'error';

// ─── Input primitive ──────────────────────────────────────────────────────────
const Field = ({
  label, type = 'text', value, onChange, autoComplete, placeholder, endContent,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  endContent?: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <span className="block text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
      {label}
    </span>
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        className="w-full rounded-xl bg-zinc-100 dark:bg-zinc-800 px-4 py-3.5 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-shadow pr-10"
        style={{ fontSize: '16px' }}
      />
      {endContent && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{endContent}</div>
      )}
    </div>
  </div>
);

// ─── Shared shell ─────────────────────────────────────────────────────────────
// Dark background fills the full screen. On mobile the card slides up from the
// bottom; on desktop it's a centered floating card with the logo above it.
const Shell = ({ children }: { children: React.ReactNode }) => (
  <div
    className="min-h-screen bg-zinc-950 flex flex-col items-center"
    style={{ minHeight: '100dvh' }}
  >
    {/* Logo area */}
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-10">
      <span
        className="text-white select-none"
        style={{
          fontStyle: 'italic',
          fontWeight: 900,
          fontSize: 'clamp(2.5rem, 10vw, 4rem)',
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        bould
      </span>
      <p className="text-zinc-400 text-sm text-center max-w-[220px]">
        Pioneering the future of online shopping
      </p>
    </div>

    {/* Card */}
    <div className="w-full max-w-md">
      {/* Mobile: rounded top, flush to bottom. Desktop: floating with bottom padding */}
      <div className="bg-white dark:bg-zinc-900 rounded-t-3xl md:rounded-3xl md:mb-8 md:mx-4 px-6 pt-6 pb-10 shadow-2xl">
        {/* Drag handle (mobile cue) */}
        <div className="mx-auto mb-5 w-10 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        {children}
      </div>
    </div>
  </div>
);

// ─── Root ─────────────────────────────────────────────────────────────────────
const OwnerLogin = observer(() => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rawToken = params.get('token');

  return rawToken
    ? <ExchangeTokenView rawToken={rawToken} navigate={navigate} />
    : <CredentialsForm navigate={navigate} />;
});

// ─── Magic link exchange ───────────────────────────────────────────────────────
function ExchangeTokenView({
  rawToken, navigate,
}: {
  rawToken: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [status, setStatus] = useState<ExchangeStatus>('exchanging');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(getBlinkoEndpoint('/api/owner/auth/exchange'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: rawToken }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const reason = (body?.error as ExchangeStatus) || 'error';
          setStatus(reason === 'expired' || reason === 'used' ? reason : 'invalid');
          return;
        }
        const data = await res.json();
        const user = RootStore.Get(UserStore);
        user.handleToken({
          token: data.jwt,
          user: {
            id: String(data.accountId),
            name: 'brand-owner',
            nickname: 'brand-owner',
            role: 'brand_owner',
          },
        });
        setStatus('success');
        setTimeout(() => navigate('/owner', { replace: true }), 600);
      } catch (err: any) {
        setMessage(err?.message ?? 'Could not sign in');
        setStatus('error');
      }
    })();
  }, [rawToken]);

  return (
    <Shell>
      {status === 'exchanging' && (
        <div className="py-8 text-center space-y-3">
          <Spinner />
          <p className="text-sm text-zinc-500">Signing you in…</p>
        </div>
      )}

      {status === 'success' && (
        <div className="py-8 text-center space-y-3">
          <div className="mx-auto inline-flex items-center justify-center size-12 rounded-full bg-emerald-100 text-emerald-600">
            <Icon icon="tabler:check" width={24} height={24} />
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">You're in. Taking you to your dashboard…</p>
        </div>
      )}

      {status !== 'exchanging' && status !== 'success' && (
        <div className="py-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center size-10 rounded-full bg-amber-100 text-amber-600 shrink-0">
              <Icon icon="tabler:alert-triangle" width={20} height={20} />
            </div>
            <div>
              <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                {status === 'expired' && 'This link has expired'}
                {status === 'used'    && 'This link was already used'}
                {status === 'invalid' && 'This link looks invalid'}
                {status === 'error'   && 'Something went wrong'}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Sign in with your credentials or ask for a new link.
              </p>
              {message && <p className="text-xs text-zinc-400 mt-0.5">{message}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/owner/login', { replace: true })}
            className="w-full rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold py-3.5 text-sm transition-opacity hover:opacity-90"
          >
            Sign in with credentials
          </button>
        </div>
      )}
    </Shell>
  );
}

// ─── Credentials form ─────────────────────────────────────────────────────────
function CredentialsForm({
  navigate,
}: {
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(getBlinkoEndpoint('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) {
        setError(data?.error || 'Invalid username or password');
        return;
      }
      if (data?.user?.role && data.user.role !== 'brand_owner') {
        setError('That account isn\'t a brand-owner login. Use your staff sign-in instead.');
        return;
      }
      const user = RootStore.Get(UserStore);
      user.handleToken({
        token: data.token,
        user: {
          id: String(data.user?.id ?? ''),
          name: data.user?.name ?? username.trim(),
          nickname: data.user?.nickname ?? username.trim(),
          role: data.user?.role ?? 'brand_owner',
        },
      });
      navigate('/owner', { replace: true });
    } catch (err: any) {
      setError(err?.message ?? 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          placeholder="your.username"
        />

        <Field
          label="Password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          endContent={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon icon={showPassword ? 'tabler:eye-off' : 'tabler:eye'} width={18} height={18} />
            </button>
          }
        />

        {error && (
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs px-4 py-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold py-4 text-sm transition-opacity hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 mt-2"
        >
          {busy ? <Spinner size="sm" color="current" /> : <>Sign In <span>→</span></>}
        </button>

        <p className="text-xs text-zinc-400 text-center pt-1">
          Lost your password? Ask your BouldHQ contact to reset it.
        </p>
      </form>
    </Shell>
  );
}

export default OwnerLogin;
