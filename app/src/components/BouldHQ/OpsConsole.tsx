import { useEffect, useState } from 'react';
import {
  Button, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Spinner, useDisclosure,
} from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

// BouldHQ Phase 9 Ops Console.
//   Connect = launches iTerm with two panes (claude + shopify theme dev) and
//   opens the local preview URL after a short delay so the theme dev server
//   has time to boot. If the workdir doesn't exist yet, prompts to import.
//   Embedded "Quick shell" is collapsed by default — pipe-mode only, kept for
//   small lookups (pwd, ls, tail a log).

type ConnectInfo = {
  storeName: string;
  workdir: string;
  themeDir: string;
  themeDirExists: boolean;
  themeSource: 'explicit' | 'theme_export' | 'workdir' | 'missing';
  previewUrl: string;
  storeUrl: string;
};

const THEME_SOURCE_LABEL: Record<ConnectInfo['themeSource'], string> = {
  explicit:     'manual path',
  theme_export: 'auto-detected (theme_export__*)',
  workdir:      'workdir root',
  missing:      'workdir missing',
};

const DEV_SERVER_BOOT_MS = 6000;

export function OpsConsole({ tagId, tagName }: { tagId: number; tagName: string }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const importModal = useDisclosure();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.storeProfile.connectInfo.query({ tagId })
      .then((i) => { if (!cancelled) { setInfo(i as ConnectInfo); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Failed to load connect info'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tagId, refreshKey]);

  const onConnect = async () => {
    if (!info) return;
    if (!info.themeDirExists) {
      importModal.onOpen();
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const r = await api.storeProfile.openInTerminal.mutate({ tagId });
      // Give shopify theme dev a few seconds to boot before opening preview.
      setTimeout(() => {
        try { window.open(r.previewUrl, '_blank', 'noopener,noreferrer'); } catch {}
      }, DEV_SERVER_BOOT_MS);
    } catch (e: any) {
      setError(e?.message ?? 'Connect failed');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <section aria-label="Ops console" className="rounded-xl border border-divider bg-content1">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-divider">
        <div className="flex items-center gap-2 mr-auto">
          <Icon icon="tabler:terminal-2" width={16} height={16} className="text-default-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-default-600">Ops Console</h2>
          {info && (
            <Chip size="sm" variant="flat" color={info.themeDirExists ? 'success' : 'warning'}>
              {info.themeDirExists ? 'ready' : 'workdir missing'}
            </Chip>
          )}
        </div>
        <Button
          size="sm" variant="flat"
          onPress={importModal.onOpen}
          startContent={<Icon icon="tabler:folder-symlink" width={14} height={14} />}
        >
          Import folder…
        </Button>
        <Button
          size="sm" color="primary"
          isDisabled={!info || loading}
          isLoading={launching}
          onPress={onConnect}
          startContent={!launching && <Icon icon="tabler:plug-connected" width={14} height={14} />}
        >
          Connect
        </Button>
      </header>

      <div className="px-4 py-3 space-y-2 text-sm">
        {loading && <Spinner size="sm" />}
        {info && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-default-500 uppercase tracking-wider text-[10px] mb-0.5">Workdir</div>
                <div className="font-mono text-default-700 truncate">{info.workdir}</div>
              </div>
              <div>
                <div className="text-default-500 uppercase tracking-wider text-[10px] mb-0.5 flex items-center gap-1.5">
                  <span>Theme folder</span>
                  <Chip size="sm" variant="flat" color={info.themeSource === 'theme_export' ? 'success' : info.themeSource === 'missing' ? 'warning' : 'default'}
                    classNames={{ base: 'h-4 px-1.5', content: 'text-[9px] font-medium leading-none uppercase tracking-wide' }}>
                    {THEME_SOURCE_LABEL[info.themeSource]}
                  </Chip>
                </div>
                <div className="font-mono text-default-700 truncate">{info.themeDir}</div>
              </div>
              <div>
                <div className="text-default-500 uppercase tracking-wider text-[10px] mb-0.5">Preview URL</div>
                <a href={info.previewUrl} target="_blank" rel="noopener noreferrer"
                   className="font-mono text-primary truncate hover:underline">{info.previewUrl}</a>
              </div>
              <div>
                <div className="text-default-500 uppercase tracking-wider text-[10px] mb-0.5">Shopify --store</div>
                <div className="font-mono text-default-700 truncate">{info.storeUrl || <span className="text-default-400">not set — add it to the store profile</span>}</div>
              </div>
            </div>
            {!info.themeDirExists && (
              <div className="rounded-md bg-warning/10 border border-warning/30 text-warning text-xs px-3 py-2">
                The theme folder for this store doesn't exist yet. Use <strong>Import folder…</strong> to copy it from your local disk.
              </div>
            )}
          </>
        )}
        {error && (
          <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">
            {error}
          </div>
        )}
        <p className="text-xs text-default-500 pt-1">
          Connect opens iTerm with two panes (<code className="font-mono">claude</code> + <code className="font-mono">shopify theme dev</code>) cd'd into the theme folder, then opens the preview URL in a new tab after ~{Math.round(DEV_SERVER_BOOT_MS / 1000)}s.
        </p>
      </div>

      <ImportFolderModal
        tagId={tagId}
        tagName={tagName}
        isOpen={importModal.isOpen}
        onClose={importModal.onClose}
        onImported={() => { importModal.onClose(); setRefreshKey((k) => k + 1); }}
        suggestedDefault={info?.workdir ? null : `~/Desktop/${tagName}`}
      />
    </section>
  );
}

function ImportFolderModal({
  tagId, tagName, isOpen, onClose, onImported, suggestedDefault,
}: {
  tagId: number; tagName: string;
  isOpen: boolean; onClose: () => void;
  onImported: () => void;
  suggestedDefault: string | null;
}) {
  const [source, setSource] = useState<string>(suggestedDefault ?? `~/Desktop/${tagName}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ workdir: string; bytesCopied: number | null } | null>(null);

  useEffect(() => {
    if (isOpen) { setSource(suggestedDefault ?? `~/Desktop/${tagName}`); setError(null); setResult(null); }
  }, [isOpen, suggestedDefault, tagName]);

  const expand = (p: string) => p.startsWith('~/') ? p : p; // server will resolve absolute paths

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.storeProfile.importFromLocalPath.mutate({ tagId, sourcePath: expand(source) });
      setResult({ workdir: r.workdir, bytesCopied: r.bytesCopied });
      setTimeout(onImported, 1200);
    } catch (e: any) {
      setError(e?.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>Import folder for #{tagName}</ModalHeader>
        <ModalBody className="space-y-3 text-sm">
          {result ? (
            <div className="rounded-md bg-success/10 border border-success/30 text-success text-xs px-3 py-2">
              Imported. Workdir is now <code className="font-mono">{result.workdir}</code>
              {result.bytesCopied != null && <> · ~{(result.bytesCopied / 1024 / 1024).toFixed(1)} MB copied</>}.
            </div>
          ) : (
            <>
              <p className="text-default-700">
                Paste the absolute path to the store's folder on your Mac. BouldHQ <code className="font-mono">rsync</code>s it into{' '}
                <code className="font-mono">~/.bouldhq-workdirs/&lt;slug&gt;/</code> — your original folder is untouched.
              </p>
              <label className="block">
                <span className="text-xs text-default-500">Source folder</span>
                <Input
                  size="sm"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={`/Users/you/Desktop/${tagName}`}
                  autoFocus
                />
              </label>
              <p className="text-xs text-default-500">
                Must be a directory under your home folder. Re-running this is safe — rsync skips unchanged files and doesn't delete extras in the destination.
              </p>
              {error && (
                <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">{error}</div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {!result && (
            <>
              <Button variant="light" onPress={onClose}>Cancel</Button>
              <Button color="primary" isLoading={busy} isDisabled={!source.trim()} onPress={submit}>
                Import
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
