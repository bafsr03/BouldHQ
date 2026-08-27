import { useEffect, useState } from 'react';
import { Modal, ModalBody, ModalContent, ModalHeader, Spinner, Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { api } from '@/lib/trpc';

// Reader for HTML resources. Pulls the file via authenticated fetch, then
// renders into an iframe via a blob URL. When `editable`, a founder/manager can
// switch to a raw-HTML editor and save the file back in place.

type Props = {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  filePath: string | null;          // /api/file/... or /api/s3file/...
  editable?: boolean;               // show the Edit button (Resources only)
};

export function HtmlPreviewModal({ isOpen, onClose, fileName, filePath, editable = false }: Props) {
  // We render via a blob: URL rather than srcdoc. Reason: srcdoc iframes have
  // no document URL, so in-document anchor links (e.g. <a href="#tldr">) try to
  // navigate to about:srcdoc#tldr and load a blank page. A blob URL behaves
  // like a real page — fragment navigation scrolls normally.
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [rawHtml, setRawHtml] = useState<string>('');   // last-loaded source
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    let cancelled = false;
    let urlToRevoke: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl('');
    setIsEditing(false);
    axiosInstance
      .get(`${getBlinkoEndpoint(filePath)}?_t=${Date.now()}`, {
        responseType: 'text',
        transformResponse: [(d) => d],
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      })
      .then((res) => {
        if (cancelled) return;
        const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
        setRawHtml(body);
        const blob = new Blob([body], { type: 'text/html; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        urlToRevoke = url;
        setBlobUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? 'Failed to load document');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    };
  }, [isOpen, filePath]);

  const startEdit = () => {
    setDraft(rawHtml);
    setError(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setError(null);
  };

  const save = async () => {
    if (!filePath) return;
    setSaving(true);
    setError(null);
    try {
      await api.attachments.updateContent.mutate({ path: filePath, content: draft });
      // Reflect the saved content in the preview without a full reload.
      setRawHtml(draft);
      const blob = new Blob([draft], { type: 'text/html; charset=utf-8' });
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setIsEditing(false);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Icon icon="tabler:file-text" width={18} height={18} className="text-default-500" />
          <span className="font-medium text-sm truncate flex-1 min-w-0">{fileName}</span>

          {isEditing ? (
            <>
              <Button size="sm" variant="light" onPress={cancelEdit} isDisabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm" color="primary" onPress={save} isLoading={saving}
                startContent={!saving ? <Icon icon="tabler:device-floppy" width={14} height={14} /> : undefined}
              >
                Save
              </Button>
            </>
          ) : (
            <>
              {editable && filePath && (
                <Button
                  size="sm" variant="flat"
                  startContent={<Icon icon="tabler:edit" width={14} height={14} />}
                  onPress={startEdit}
                  isDisabled={loading || !!error}
                  title="Edit HTML"
                >
                  Edit
                </Button>
              )}
              {filePath && (
                <Button
                  size="sm" variant="flat"
                  startContent={<Icon icon="tabler:external-link" width={14} height={14} />}
                  onPress={() => {
                    const url = `${getBlinkoEndpoint(filePath)}`;
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  title="Open in new tab"
                >
                  Open
                </Button>
              )}
            </>
          )}
        </ModalHeader>
        <ModalBody className="p-0">
          {loading && (
            <div className="flex items-center justify-center py-16 text-default-500">
              <Spinner size="sm" />
              <span className="ml-2 text-sm">Loading…</span>
            </div>
          )}
          {error && (
            <div className="px-6 py-4">
              <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">
                {error}
              </div>
            </div>
          )}
          {!loading && isEditing && (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="w-full font-mono text-xs p-4 bg-default-50 text-default-900 outline-none resize-none"
              style={{ height: '78vh', border: 'none' }}
            />
          )}
          {!loading && !error && !isEditing && blobUrl && (
            <iframe
              title={fileName}
              src={blobUrl}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="w-full"
              style={{ height: '78vh', border: 'none', background: 'transparent' }}
            />
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
