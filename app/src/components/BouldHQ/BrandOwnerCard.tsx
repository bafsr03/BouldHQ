// BrandOwnerCard — credentials + magic-link share for the brand owner of a
// store. Persistent username + password are generated on first invite (the
// only time we see the plaintext); managers can reset later. Magic link
// remains as a one-tap convenience for first onboarding.

import { useEffect, useState } from 'react';
import {
  Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Spinner, useDisclosure,
} from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

type Role = 'founder' | 'manager' | 'salesman' | null;

interface Owner {
  ownerId: number;
  accountId: number;
  username: string;
  email: string | null;
  name: string;
  phone: string | null;
  invitedAt: string | Date;
}

interface MintedLink {
  url: string;
  expiresAt: Date;
}

interface FreshCredentials {
  username: string;
  password: string;
}

export function BrandOwnerCard({
  tagId, tagName, role,
}: {
  tagId: number;
  tagName: string;
  role: Role;
}) {
  const canManage = role === 'manager' || role === 'founder';

  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loginUrl, setLoginUrl] = useState<string>('');
  const [link, setLink] = useState<MintedLink | null>(null);
  const [credentials, setCredentials] = useState<FreshCredentials | null>(null);
  const [showPassword, setShowPassword] = useState(true);
  const [busy, setBusy] = useState<'invite' | 'resend' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const inviteModal = useDisclosure();
  const resetModal = useDisclosure();

  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.storeProfile.getBrandOwner.query({ tagId })
      .then((r: { owner: Owner | null; loginUrl: string }) => {
        if (cancelled) return;
        setOwner(r.owner);
        setLoginUrl(r.loginUrl);
      })
      .catch(() => { if (!cancelled) setOwner(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tagId, canManage]);

  if (!canManage) return null;

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch { /* user can long-press */ }
  };

  const resend = async () => {
    setBusy('resend'); setError(null);
    try {
      const r = await api.storeProfile.resendBrandOwnerLink.mutate({ tagId });
      setLink({ url: r.magicLinkUrl, expiresAt: new Date(r.expiresAt) });
    } catch (e: any) {
      setError(e?.message ?? 'Could not mint a new link');
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    setBusy('reset'); setError(null);
    try {
      const r = await api.storeProfile.resetBrandOwnerPassword.mutate({ tagId });
      setCredentials({ username: r.username, password: r.password });
      setShowPassword(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not reset the password');
    } finally {
      setBusy(null);
      resetModal.onClose();
    }
  };

  const shareViaSms = () => {
    if (!owner) return;
    const ownerFirstName = (owner.name ?? '').split(' ')[0] || 'there';
    const lines = [
      `Hi ${ownerFirstName} — your BouldHQ login for ${tagName}:`,
      '',
      `Open: ${loginUrl}`,
      `Username: ${owner.username}`,
    ];
    if (credentials) lines.push(`Password: ${credentials.password}`);
    if (link) {
      lines.push('');
      lines.push('One-tap link (expires in 15 min):');
      lines.push(link.url);
    }
    const body = encodeURIComponent(lines.join('\n'));
    const number = (owner.phone ?? '').replace(/[^0-9+]/g, '');
    const url = number ? `sms:${number}&body=${body}` : `sms:?body=${body}`;
    window.location.href = url;
  };

  const openAsOwner = () => {
    const target = link?.url || loginUrl;
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  return (
    <section
      aria-label="Brand owner"
      className="rounded-xl border border-divider bg-content1 p-4 md:p-5 space-y-4"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon icon="tabler:user-circle" width={18} height={18} className="text-default-500 shrink-0" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600 truncate">
            Brand owner access
          </h2>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-default-500">
          <Spinner size="sm" /> Checking…
        </div>
      ) : owner ? (
        <OwnerSummary
          owner={owner}
          loginUrl={loginUrl}
          credentials={credentials}
          showPassword={showPassword}
          onTogglePassword={() => setShowPassword((s) => !s)}
          onCopy={copy}
          copied={copied}
        />
      ) : (
        <NoOwnerYet onInvite={inviteModal.onOpen} />
      )}

      {error && (
        <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">
          {error}
        </div>
      )}

      {owner && (
        <ActionButtons
          loginUrl={loginUrl}
          hasLink={!!link}
          busy={busy}
          onResend={resend}
          onReset={resetModal.onOpen}
          onShareSms={shareViaSms}
          onOpenAsOwner={openAsOwner}
          onCopyLoginUrl={() => copy(loginUrl, 'loginUrl')}
          copied={copied}
        />
      )}

      {link && (
        <ActiveLinkBlock
          link={link}
          onCopy={() => copy(link.url, 'link')}
          copied={copied === 'link'}
        />
      )}

      <InviteOwnerModal
        isOpen={inviteModal.isOpen}
        onClose={inviteModal.onClose}
        tagId={tagId}
        tagName={tagName}
        onInvited={(res) => {
          setOwner({
            ownerId: res.ownerId,
            accountId: res.accountId,
            username: res.username,
            email: res.email,
            name: res.name,
            phone: res.phone,
            invitedAt: new Date(),
          });
          setLoginUrl(res.loginUrl);
          setLink({ url: res.magicLinkUrl, expiresAt: new Date(res.expiresAt) });
          if (res.credentials) {
            setCredentials(res.credentials);
            setShowPassword(true);
          }
          inviteModal.onClose();
        }}
      />

      <ResetPasswordModal
        isOpen={resetModal.isOpen}
        onClose={resetModal.onClose}
        busy={busy === 'reset'}
        onConfirm={resetPassword}
        ownerName={owner?.name ?? ''}
      />
    </section>
  );
}

// --- Sub-components -----------------------------------------------------------

function OwnerSummary({
  owner, loginUrl, credentials, showPassword, onTogglePassword, onCopy, copied,
}: {
  owner: Owner;
  loginUrl: string;
  credentials: FreshCredentials | null;
  showPassword: boolean;
  onTogglePassword: () => void;
  onCopy: (value: string, key: string) => void;
  copied: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <div className="text-base font-semibold">{owner.name}</div>
        {owner.email && <div className="text-sm text-default-500 break-all">{owner.email}</div>}
        {owner.phone && <div className="text-xs text-default-400">{owner.phone}</div>}
      </div>

      <div className="grid gap-2">
        <CredentialRow
          label="Login URL"
          value={loginUrl}
          onCopy={() => onCopy(loginUrl, 'loginUrl')}
          copied={copied === 'loginUrl'}
          monospace
        />
        <CredentialRow
          label="Username"
          value={owner.username}
          onCopy={() => onCopy(owner.username, 'username')}
          copied={copied === 'username'}
          monospace
        />
        {credentials ? (
          <CredentialRow
            label="Password (shown once)"
            value={showPassword ? credentials.password : '••••••••••••'}
            onCopy={() => onCopy(credentials.password, 'password')}
            copied={copied === 'password'}
            monospace
            trailing={
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={onTogglePassword}
                className="text-default-400 hover:text-default-600 px-1"
              >
                <Icon icon={showPassword ? 'tabler:eye-off' : 'tabler:eye'} width={14} height={14} />
              </button>
            }
          />
        ) : (
          <div className="text-xs text-default-400 px-1">
            Password is hidden after the page reloads. Reset to generate a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function NoOwnerYet({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <p className="text-sm text-default-500">
        No brand-owner invited yet. They'll get a username, password, and a one-tap link.
      </p>
      <Button
        color="primary"
        size="md"
        onPress={onInvite}
        startContent={<Icon icon="tabler:user-plus" width={16} height={16} />}
      >
        Invite owner
      </Button>
    </div>
  );
}

function CredentialRow({
  label, value, onCopy, copied, monospace, trailing,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  monospace?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-default-500">{label}</span>
      <div className="flex items-center gap-2 rounded-md border border-divider bg-content2 px-2 py-1.5">
        <div className={`flex-1 min-w-0 truncate ${monospace ? 'font-mono text-xs' : 'text-sm'}`}>
          {value}
        </div>
        {trailing}
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy"
          className="shrink-0 text-default-400 hover:text-default-600 px-1"
        >
          <Icon icon={copied ? 'tabler:check' : 'tabler:copy'} width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function ActionButtons({
  loginUrl, hasLink, busy, onResend, onReset, onShareSms, onOpenAsOwner,
  onCopyLoginUrl, copied,
}: {
  loginUrl: string;
  hasLink: boolean;
  busy: 'invite' | 'resend' | 'reset' | null;
  onResend: () => void;
  onReset: () => void;
  onShareSms: () => void;
  onOpenAsOwner: () => void;
  onCopyLoginUrl: () => void;
  copied: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button
        size="sm" variant="flat"
        onPress={onShareSms}
        startContent={<Icon icon="tabler:brand-messenger" width={14} height={14} />}
      >
        Send via iMessage
      </Button>
      <Button
        size="sm" variant="flat"
        onPress={onCopyLoginUrl}
        startContent={<Icon icon={copied === 'loginUrl' ? 'tabler:check' : 'tabler:copy'} width={14} height={14} />}
        isDisabled={!loginUrl}
      >
        Copy login URL
      </Button>
      <Button
        size="sm" variant="flat"
        onPress={onOpenAsOwner}
        startContent={<Icon icon="tabler:external-link" width={14} height={14} />}
      >
        {hasLink ? 'Open with link' : 'Open login page'}
      </Button>
      <Button
        size="sm" variant="flat" color="primary"
        onPress={onResend}
        isDisabled={busy === 'resend'}
        isLoading={busy === 'resend'}
        startContent={<Icon icon="tabler:link" width={14} height={14} />}
      >
        Mint quick link
      </Button>
      <Button
        size="sm" variant="flat" color="warning"
        onPress={onReset}
        isDisabled={busy === 'reset'}
        startContent={<Icon icon="tabler:key" width={14} height={14} />}
      >
        Reset password
      </Button>
    </div>
  );
}

function ActiveLinkBlock({
  link, onCopy, copied,
}: {
  link: MintedLink;
  onCopy: () => void;
  copied: boolean;
}) {
  const minutesLeft = Math.max(0, Math.round((link.expiresAt.getTime() - Date.now()) / 60000));
  return (
    <div className="space-y-2 pt-2 border-t border-divider">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-default-500">One-tap link</div>
        <div className="text-xs text-default-500">
          {minutesLeft > 0 ? `Expires in ~${minutesLeft} min` : 'Expired'}
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-divider bg-content2 px-2 py-1.5">
        <div className="flex-1 min-w-0 truncate font-mono text-xs">{link.url}</div>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy link"
          className="shrink-0 text-default-400 hover:text-default-600 px-1"
        >
          <Icon icon={copied ? 'tabler:check' : 'tabler:copy'} width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function InviteOwnerModal({
  isOpen, onClose, tagId, tagName, onInvited,
}: {
  isOpen: boolean;
  onClose: () => void;
  tagId: number;
  tagName: string;
  onInvited: (res: {
    ownerId: number;
    accountId: number;
    username: string;
    email: string | null;
    name: string;
    phone: string | null;
    magicLinkUrl: string;
    expiresAt: Date;
    loginUrl: string;
    credentials: FreshCredentials | null;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) { setName(''); setEmail(''); setPhone(''); setError(null); }
  }, [isOpen]);

  const valid = name.trim().length > 0 && /^[^@]+@[^@]+\.[^@]+$/.test(email);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.storeProfile.inviteBrandOwner.mutate({
        tagId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
      });
      onInvited({
        ownerId: r.ownerId,
        accountId: r.accountId,
        username: r.credentials?.username ?? '',
        email: email.trim().toLowerCase(),
        name: name.trim(),
        phone: phone.trim() || null,
        magicLinkUrl: r.magicLinkUrl,
        expiresAt: new Date(r.expiresAt),
        loginUrl: r.loginUrl,
        credentials: r.credentials,
      });
    } catch (e: any) {
      setError(e?.message ?? 'Could not invite owner');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>Invite owner of {tagName}</ModalHeader>
        <ModalBody className="space-y-3">
          <Field label="Full name">
            <Input
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              inputMode="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Phone (optional)" hint="If provided, the iMessage button pre-fills their number.">
            <Input
              type="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          {error && (
            <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">
              {error}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={busy}>Cancel</Button>
          <Button color="primary" onPress={submit} isDisabled={busy || !valid} isLoading={busy}>
            Invite + generate password
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ResetPasswordModal({
  isOpen, onClose, busy, onConfirm, ownerName,
}: {
  isOpen: boolean;
  onClose: () => void;
  busy: boolean;
  onConfirm: () => void;
  ownerName: string;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalContent>
        <ModalHeader>Reset password</ModalHeader>
        <ModalBody className="space-y-2">
          <p className="text-sm">
            Generate a new password for {ownerName || 'this brand owner'}? Their current password
            will stop working immediately.
          </p>
          <p className="text-xs text-default-500">
            You'll see the new password once on the next screen. Share it with the merchant
            before leaving the page.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} isDisabled={busy}>Cancel</Button>
          <Button color="warning" onPress={onConfirm} isLoading={busy}>
            Reset password
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function Field({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-default-700 mb-1.5">{label}</span>
      {children}
      {hint && <p className="text-xs text-default-500 mt-1">{hint}</p>}
    </label>
  );
}
