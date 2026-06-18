import { useEffect, useState } from 'react';
import { Modal, ModalBody, ModalContent, ModalHeader, Spinner, Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';

// Reader for HTML resources. Pulls the file via authenticated fetch, then
// renders into an iframe via srcdoc — sidesteps token-in-URL gymnastics and
// keeps the embedded styles fully isolated from the host app's CSS.

type Props = {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  filePath: string | null;          // /api/file/... or /api/s3file/...
};

export function HtmlPreviewModal({ isOpen, onClose, fileName, filePath }: Props) {
  // We render via a blob: URL rather than srcdoc. Reason: srcdoc iframes have
  // no document URL, so in-document anchor links (e.g. <a href="#tldr">) try to
  // navigate to about:srcdoc#tldr and load a blank page. A blob URL behaves
  // like a real page — fragment navigation scrolls normally.
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    let cancelled = false;
    let urlToRevoke: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl('');
    axiosInstance
      .get(`${getBlinkoEndpoint(filePath)}?_t=${Date.now()}`, {
        responseType: 'text',
        transformResponse: [(d) => d],
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      })
      .then((res) => {
        if (cancelled) return;
        const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Icon icon="tabler:file-text" width={18} height={18} className="text-default-500" />
          <span className="font-medium text-sm truncate flex-1 min-w-0">{fileName}</span>
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
          {!loading && !error && blobUrl && (
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
