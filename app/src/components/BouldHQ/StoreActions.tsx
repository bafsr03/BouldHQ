import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownSection,
  DropdownTrigger, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  useDisclosure,
} from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

type Role = 'founder' | 'manager' | 'salesman' | null;

// Header chip + menu on /stores/:tagId. Archive/Restore for manager+;
// Delete (with typed-name confirmation) for founders only.
export function StoreActions({
  tagId, tagName, role, archivedAt, onChanged,
}: {
  tagId: number;
  tagName: string;
  role: Role;
  archivedAt: string | Date | null;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const archiveModal = useDisclosure();
  const deleteModal = useDisclosure();
  const [busy, setBusy] = useState<'archive' | 'restore' | null>(null);

  const canArchive = role === 'manager' || role === 'founder';
  const canDelete = role === 'founder';
  const isArchived = archivedAt != null;

  if (!canArchive && !canDelete) return null;

  const archive = async () => {
    setBusy('archive');
    try { await api.storeProfile.archive.mutate({ tagId }); onChanged(); }
    catch (e) { console.error(e); } finally { setBusy(null); archiveModal.onClose(); }
  };
  const restore = async () => {
    setBusy('restore');
    try { await api.storeProfile.unarchive.mutate({ tagId }); onChanged(); }
    catch (e) { console.error(e); } finally { setBusy(null); }
  };

  return (
    <>
      {isArchived ? (
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="flat" color="default" startContent={
            <Icon icon="tabler:archive" width={12} height={12} />
          }>archived</Chip>
          {canArchive && (
            <Button size="sm" variant="flat" onPress={restore} isLoading={busy === 'restore'}
              startContent={!busy && <Icon icon="tabler:archive-off" width={14} height={14} />}>
              Restore
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="flat" color="danger" onPress={deleteModal.onOpen}
              startContent={<Icon icon="tabler:trash" width={14} height={14} />}>
              Delete
            </Button>
          )}
        </div>
      ) : (
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button size="sm" variant="flat" isIconOnly aria-label="Store actions">
              <Icon icon="tabler:dots-vertical" width={16} height={16} />
            </Button>
          </DropdownTrigger>
          <DropdownMenu aria-label="Store actions">
            <DropdownSection>
              {canArchive ? (
                <DropdownItem key="archive" onPress={archiveModal.onOpen}
                  startContent={<Icon icon="tabler:archive" width={14} height={14} />}>
                  Archive store
                </DropdownItem>
              ) : null}
              {canDelete ? (
                <DropdownItem key="delete" onPress={deleteModal.onOpen} color="danger"
                  startContent={<Icon icon="tabler:trash" width={14} height={14} className="text-danger" />}
                  className="text-danger">
                  Delete permanently…
                </DropdownItem>
              ) : null}
            </DropdownSection>
          </DropdownMenu>
        </Dropdown>
      )}

      <Modal isOpen={archiveModal.isOpen} onClose={archiveModal.onClose} size="md">
        <ModalContent>
          <ModalHeader>Archive #{tagName}?</ModalHeader>
          <ModalBody className="text-sm text-default-700 space-y-2">
            <p>The store is hidden from the active stores list, the team switcher's store-aware queries, and the assistant. Notes stay tagged; nothing is deleted.</p>
            <p className="text-xs text-default-500">Manager or founder can restore it from this page at any time.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={archiveModal.onClose}>Cancel</Button>
            <Button color="primary" isLoading={busy === 'archive'} onPress={archive}>
              Archive
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <DeletePermanentlyModal
        tagId={tagId} tagName={tagName}
        isOpen={deleteModal.isOpen} onClose={deleteModal.onClose}
        onDeleted={() => { deleteModal.onClose(); navigate('/stores'); }}
      />
    </>
  );
}

function DeletePermanentlyModal({
  tagId, tagName, isOpen, onClose, onDeleted,
}: {
  tagId: number; tagName: string;
  isOpen: boolean; onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ deletedRequests: number; orphanedNotes: number } | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.storeProfile.deletePermanently.mutate({ tagId, confirmName: confirm });
      setResult({ deletedRequests: r.deletedRequests, orphanedNotes: r.orphanedNotes });
      setTimeout(onDeleted, 1500);
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="text-danger">Delete #{tagName} permanently</ModalHeader>
        <ModalBody className="text-sm text-default-700 space-y-3">
          {result ? (
            <div className="rounded-md bg-success/10 border border-success/30 text-success text-sm px-3 py-2">
              Store deleted. {result.deletedRequests} request{result.deletedRequests === 1 ? '' : 's'} cascaded; {result.orphanedNotes} note{result.orphanedNotes === 1 ? '' : 's'} kept (untagged).
            </div>
          ) : (
            <>
              <p>This is permanent. The tag, store profile, and every request against this store will be deleted.</p>
              <p>Notes that were tagged with <code className="font-mono">#{tagName}</code> stay alive in your personal feed — they just lose the tag.</p>
              <label className="block">
                <span className="text-xs text-default-500">Type <span className="font-mono font-bold">{tagName}</span> to confirm</span>
                <Input
                  size="sm" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={tagName}
                  autoFocus
                />
              </label>
              {error && (
                <div className="rounded-md bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2">
                  {error}
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {!result && (
            <>
              <Button variant="light" onPress={onClose}>Cancel</Button>
              <Button color="danger" isLoading={busy}
                isDisabled={confirm !== tagName}
                onPress={submit}>
                Delete permanently
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
