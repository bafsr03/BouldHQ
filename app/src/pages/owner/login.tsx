// Brand-owner login landing. The merchant taps a magic link → lands here with
// ?token=... → we exchange it for a 30-day JWT and stash it in the same
// localStorage key the rest of the app uses, then redirect to /owner.

import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spinner, Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';

type Status = 'exchanging' | 'success' | 'invalid' | 'expired' | 'used' | 'error';

const OwnerLogin = observer(() => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('exchanging');
  const [message, setMessage] = useState<string | null>(null);

  const rawToken = params.get('token');

  useEffect(() => {
    if (!rawToken) { setStatus('invalid'); return; }
    (async () => {
      try {
        const res = await fetch(getBlinkoEndpoint('/api/owner/auth/exchange'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: rawToken }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const reason = (body?.error as Status) || 'error';
          setStatus(reason === 'expired' || reason === 'used' ? reason : 'invalid');
          return;
        }
        const data = await res.json();
        const user = RootStore.Get(UserStore);
        user.tokenData.save({
          token: data.jwt,
          user: {
            id: String(data.accountId),
            name: 'brand-owner',
            nickname: 'brand-owner',
            role: 'brand_owner',
          },
        } as any);
        setStatus('success');
        setTimeout(() => navigate('/owner', { replace: true }), 600);
      } catch (err: any) {
        setMessage(err?.message ?? 'Could not sign in');
        setStatus('error');
      }
    })();
  }, [rawToken]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-divider bg-content1 p-6 text-center space-y-4">
        {status === 'exchanging' && (
          <>
            <Spinner />
            <p className="text-sm text-default-500">Signing you in…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="mx-auto inline-flex items-center justify-center size-12 rounded-full bg-success/10 text-success">
              <Icon icon="tabler:check" width={24} height={24} />
            </div>
            <p className="text-sm">You're in. Taking you to your dashboard…</p>
          </>
        )}
        {status !== 'exchanging' && status !== 'success' && (
          <>
            <div className="mx-auto inline-flex items-center justify-center size-12 rounded-full bg-warning/10 text-warning">
              <Icon icon="tabler:alert-triangle" width={24} height={24} />
            </div>
            <h1 className="text-base font-semibold">
              {status === 'expired' && 'This link has expired'}
              {status === 'used' && 'This link was already used'}
              {status === 'invalid' && 'This link looks invalid'}
              {status === 'error' && 'Something went wrong'}
            </h1>
            <p className="text-sm text-default-500">
              Reach out to your BouldHQ contact and they can send you a new one.
            </p>
            {message && <p className="text-xs text-default-400">{message}</p>}
            <Button variant="flat" onPress={() => window.location.reload()}>Try again</Button>
          </>
        )}
      </div>
    </div>
  );
});

export default OwnerLogin;
