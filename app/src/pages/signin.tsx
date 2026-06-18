import React, { useEffect, useState } from "react";
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from "@/store";
import { ToastPlugin } from "@/store/module/Toast/Toast";
import { useTranslation } from "react-i18next";
import { StorageState } from "@/store/standard/StorageState";
import { UserStore } from "@/store/user";
import { PromiseState } from "@/store/standard/PromiseState";
import { api, reinitializeTrpcApi } from "@/lib/trpc";
import { signIn } from "@/components/Auth/auth-client";
import { useNavigate, Link } from "react-router-dom";
import { saveBlinkoEndpoint, getSavedEndpoint, getBlinkoEndpoint } from "@/lib/blinkoEndpoint";
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { BlinkoStore } from "@/store/blinkoStore";
import { LoginShell, LoginField, LoginButton } from "@/components/Auth/LoginShell";

type OAuthProvider = {
  id: string;
  name: string;
  icon?: string;
};

export default function Component() {
  const [isVisible, setIsVisible] = React.useState(false);
  const [user, setUser] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [canRegister, setCanRegister] = useState(false);
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [loadingProvider, setLoadingProvider] = useState<string>('');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const blinko = RootStore.Get(BlinkoStore);

  useEffect(() => {
    blinko.config.call();
  }, []);

  useEffect(() => {
    try {
      setIsTauriEnv(!!(window as any).__TAURI__);
    } catch {
      setIsTauriEnv(false);
    }
  }, []);

  useEffect(() => {
    api.public.oauthProviders.query().then(providers => {
      setProviders(providers);
    });
  }, []);

  const SignIn = new PromiseState({
    function: async () => {
      try {
        if (isTauriEnv) {
          reinitializeTrpcApi();
        }
        const res = await signIn('credentials', {
          username: user ?? userStorage.value,
          password: password ?? passwordStorage.value,
          callbackUrl: '/',
          redirect: false,
        });

        if (res?.requiresTwoFactor) {
          return res;
        }

        if (res?.ok) {
          navigate('/');
        }

        if (res?.error) {
          RootStore.Get(ToastPlugin).error(res.error);
        }

        return res;
      } catch (error) {
        console.error('SignIn error:', error);
        return { ok: false, error: 'Login failed' };
      }
    }
  });

  const userStorage = new StorageState({ key: 'username' });
  const passwordStorage = new StorageState({ key: 'password' });
  const endpointStorage = new StorageState({ key: 'blinkoEndpoint' });

  useEffect(() => {
    try {
      RootStore.Get(UserStore).canRegister.call().then(v => {
        setCanRegister(v ?? false);
      });
      if (userStorage.value) {
        setUser(userStorage.value);
      }
      if (passwordStorage.value) {
        setPassword(passwordStorage.value);
      }
      if (getSavedEndpoint()) {
        setEndpoint(getSavedEndpoint());
      }
    } catch (error) {
      console.error('Storage error:', error);
    }
  }, []);

  const login = async () => {
    try {
      await SignIn.call();
      userStorage.setValue(user);
      passwordStorage.setValue(password);

      if (isTauriEnv && endpoint) {
        saveBlinkoEndpoint(endpoint);
      }
    } catch (error) {
      console.error('Login error:', error);
      RootStore.Get(ToastPlugin).error(t('login-failed'));
    }
  };

  return (
    <LoginShell>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); login(); }}>
        {providers.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  disabled={loadingProvider === provider.id}
                  onClick={() => {
                    setLoadingProvider(provider.id);
                    window.location.href = `${getBlinkoEndpoint()}api/auth/${provider.id}`;
                  }}
                  className="w-full rounded-xl border border-zinc-200 bg-white text-zinc-800 font-medium py-3 text-sm flex items-center justify-center gap-2 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                >
                  {provider.icon && <Icon icon={provider.icon} className="text-lg" />}
                  {t('sign-in-with-provider', { provider: provider.name })}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-zinc-200" />
              <span className="text-xs text-zinc-400 uppercase tracking-wider">{t('or')}</span>
              <div className="flex-1 h-px bg-zinc-200" />
            </div>
          </>
        )}

        {isTauriEnv && (
          <LoginField
            label={t('blinko-endpoint')}
            name="endpoint"
            value={endpoint.replace(/"/g, '')}
            onChange={(v) => {
              const clean = v.trim().replace(/"/g, '');
              setEndpoint(clean);
              endpointStorage.save(clean);
            }}
            placeholder={t('enter-blinko-endpoint')}
          />
        )}

        <LoginField
          label={t('username')}
          name="username"
          value={user}
          onChange={(v) => setUser(v.trim())}
          autoComplete="username"
          placeholder={t('enter-your-name')}
          onEnter={login}
        />

        <LoginField
          label={t('password')}
          name="password"
          type={isVisible ? 'text' : 'password'}
          value={password}
          onChange={(v) => setPassword(v.trim())}
          autoComplete="current-password"
          onEnter={login}
          endContent={
            <button
              type="button"
              onClick={() => setIsVisible(!isVisible)}
              aria-label={isVisible ? 'Hide password' : 'Show password'}
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <Icon
                className="text-xl"
                icon={isVisible ? 'solar:eye-closed-linear' : 'solar:eye-bold'}
              />
            </button>
          }
        />

        <div className="pt-1">
          <LoginButton type="submit" loading={SignIn.loading.value} disabled={!user || !password}>
            {t('sign-in')} <span aria-hidden>→</span>
          </LoginButton>
        </div>

        {canRegister && (
          <p className="text-center text-xs text-zinc-500">
            {t('need-to-create-an-account')}&nbsp;
            <Link to="/signup" className="font-semibold text-zinc-900 hover:underline">
              {t('sign-up')}
            </Link>
          </p>
        )}

        {blinko.config.value?.signinFooterEnabled &&
         blinko.config.value?.signinFooterText?.trim() && (
          <div className="mt-1 text-center max-w-full">
            <div className="text-xs text-zinc-400 break-words px-2">
              <ReactMarkdown
                rehypePlugins={[rehypeRaw]}
                components={{
                  p: ({ node, ...props }) => <span {...props} />,
                  a: ({ node, ...props }) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-zinc-600 underline"
                    />
                  ),
                  strong: ({ node, ...props }) => <strong {...props} />,
                  em: ({ node, ...props }) => <em {...props} />,
                  br: ({ node, ...props }) => <br {...props} />
                }}
              >
                {blinko.config.value.signinFooterText}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </form>
    </LoginShell>
  );
}
