// Brand-owner login — shares the app-wide login look (see LoginShell).
// Two modes:
//   1. ?token=… — magic link exchange → 30-day JWT
//   2. no token  — username / password form

import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { LoginShell, LoginField, LoginButton } from '@/components/Auth/LoginShell';

type ExchangeStatus = 'exchanging' | 'success' | 'invalid' | 'expired' | 'used' | 'error';

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
    <LoginShell>
      {status === 'exchanging' && (
        <div className="py-8 text-center space-y-3">
          <span className="inline-block size-6 rounded-full border-2 border-zinc-300 border-t-zinc-800 animate-spin" />
          <p className="text-sm text-zinc-500">Signing you in…</p>
        </div>
      )}

      {status === 'success' && (
        <div className="py-8 text-center space-y-3">
          <div className="mx-auto inline-flex items-center justify-center size-12 rounded-full bg-emerald-100 text-emerald-600">
            <Icon icon="tabler:check" width={24} height={24} />
          </div>
          <p className="text-sm text-zinc-600">You're in. Taking you to your dashboard…</p>
        </div>
      )}

      {status !== 'exchanging' && status !== 'success' && (
        <div className="py-2 space-y-4">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center size-10 rounded-full bg-amber-100 text-amber-600 shrink-0">
              <Icon icon="tabler:alert-triangle" width={20} height={20} />
            </div>
            <div>
              <p className="font-semibold text-sm text-zinc-900">
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
          <LoginButton onClick={() => navigate('/owner/login', { replace: true })}>
            Sign in with credentials
          </LoginButton>
        </div>
      )}
    </LoginShell>
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

  const submit = async () => {
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
    <LoginShell>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <LoginField
          label="Username"
          name="username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          placeholder="your.username"
          onEnter={submit}
        />

        <LoginField
          label="Password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          onEnter={submit}
          endContent={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon icon={showPassword ? 'tabler:eye-off' : 'tabler:eye'} width={18} height={18} />
            </button>
          }
        />

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3">
            {error}
          </div>
        )}

        <div className="pt-1">
          <LoginButton type="submit" loading={busy} disabled={!username || !password}>
            Sign In <span aria-hidden>→</span>
          </LoginButton>
        </div>

        <p className="text-xs text-zinc-400 text-center pt-1">
          Lost your password? Ask your BouldHQ contact to reset it.
        </p>
      </form>
    </LoginShell>
  );
}

export default OwnerLogin;
