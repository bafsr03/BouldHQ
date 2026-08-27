import { Store } from "./standard/base";
import { makeAutoObservable } from "mobx";
import { useLocation, useSearchParams, useNavigate } from "react-router-dom";
import { BlinkoStore } from "./blinkoStore";
import { RootStore } from ".";
import { ResourceType } from "@shared/lib/types";
import { useEffect, useState } from "react";
import { api } from "@/lib/trpc";
import { PromiseCall } from "./standard/PromiseState";
import { t } from "i18next";
import { ToastPlugin } from "./module/Toast/Toast";
import { DialogStore } from "./module/Dialog";
import { Button, Input } from "@heroui/react";
import axiosInstance from "@/lib/axios";
import { getBlinkoEndpoint } from "@/lib/blinkoEndpoint";

export class ResourceStore implements Store {
  sid = 'resourceStore';
  currentFolder: string | null = null;
  selectedItems: Set<number> = new Set();
  contextMenuResource: ResourceType | null = null;
  refreshTicker = 0
  clipboard: { type: 'cut' | 'copy', items: ResourceType[] } | null = null;

  // BouldHQ — in-app HTML preview modal state.
  htmlPreview: { name: string; path: string } | null = null;
  previewHtml(file: { name: string; path: string }) { this.htmlPreview = file; }
  closeHtmlPreview() { this.htmlPreview = null; }

  // BouldHQ — in-app image lightbox state. `src` is a fully-resolved,
  // token-bearing URL (built by the caller via getBlinkoEndpoint). Driven from
  // the row click so it's reliable even though the thumbnail lives inside a
  // drag-and-drop row.
  imagePreview: { src: string } | null = null;
  previewImage(src: string) { this.imagePreview = { src }; }
  closeImagePreview() { this.imagePreview = null; }

  constructor() {
    makeAutoObservable(this);
  }

  get blinko() {
    return RootStore.Get(BlinkoStore);
  }

  setCurrentFolder = (folder: string | null) => {
    this.currentFolder = folder;
  }

  selectAllFiles = (resources: ResourceType[]) => {
    this.selectedItems.clear();
    resources.forEach(resource => {
      if (!resource.isFolder && resource.id) {
        this.selectedItems.add(resource.id);
      }
    });
  };

  toggleSelect = (id: number) => {
    const newSet = new Set(this.selectedItems);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    this.selectedItems = newSet;
  }

  clearSelection = () => {
    this.selectedItems = new Set();
  }

  loadResources = (folder?: string) => {
    this.clearSelection();
    this.blinko.resourceList.resetAndCall({
      folder: folder || undefined,
    });
  }

  loadNextPage = () => {
    this.blinko.resourceList.callNextPage({
      folder: this.currentFolder || undefined,
    });
  }

  handleDragEnd = async (result: any) => {
    if (!result.destination) return;

    const { source, destination } = result;

    const destItem = this.blinko.resourceList.value?.[destination.index];
    if (!destItem?.isFolder) return;

    const itemsToMove = Array.from(this.selectedItems).map(id =>
      this.blinko.resourceList.value?.find(item => item.id === Number(id))
    ).filter((item): item is NonNullable<typeof item> => item != null);

    if (itemsToMove.length === 0) {
      const draggedItem = this.blinko.resourceList.value?.[source.index];
      if (!draggedItem) return;
      itemsToMove.push(draggedItem);
    }

    const targetPath = this.currentFolder
      ? `${this.currentFolder}/${destItem.folderName}`
      : destItem.folderName;

    await RootStore.Get(ToastPlugin).promise(
      PromiseCall(api.attachments.move.mutate({
        sourceIds: itemsToMove.map(item => item.id!),
        targetFolder: targetPath!.split('/').join(',')
      }), { autoAlert: false }),
      {
        loading: t("operation-in-progress"),
        success: t("operation-success"),
        error: t("operation-failed")
      }
    );

    this.refreshTicker++;
    this.clearSelection();
  };

  navigateToFolder = async (folderName: string, navigate: any) => {
    const newPath = this.currentFolder
      ? `${this.currentFolder}/${folderName}`
      : folderName;

    this.setCurrentFolder(newPath);
    this.loadResources(newPath);

    await navigate(`/resources?folder=${encodeURIComponent(newPath)}`);
  }

  navigateBack = async (navigate: any) => {
    if (!this.currentFolder) return;

    const folders = this.currentFolder.split('/');
    folders.pop();
    const parentFolder = folders.join('/');

    this.setCurrentFolder(parentFolder || null);
    this.loadResources(parentFolder || undefined);

    if (parentFolder) {
      await navigate(`/resources?folder=${encodeURIComponent(parentFolder)}`);
    } else {
      await navigate('/resources');
    }
  }

  setContextMenuResource = (resource: ResourceType | null) => {
    this.contextMenuResource = resource;
  }

  setCutItems = (items: ResourceType[]) => {
    this.clipboard = { type: 'cut', items };
  };

  clearClipboard = () => {
    this.clipboard = null;
  };

  use() {
    const [searchParams] = useSearchParams();

    useEffect(() => {
      const folder = searchParams.get('folder');
      if (folder !== this.currentFolder) {
        this.setCurrentFolder(folder);
        this.loadResources(folder || undefined);
      }
    }, [searchParams]);

    useEffect(() => {
      this.loadResources(this.currentFolder || undefined);
    }, [this.refreshTicker]);
  }

  handleNewFolder = () => {
    const blinko = RootStore.Get(BlinkoStore);
    const currentResources = blinko.resourceList.value || [];

    RootStore.Get(DialogStore).setData({
      isOpen: true,
      size: 'sm',
      title: t('new-folder'),
      content: () => {
        const [newName, setNewName] = useState<string>('');
        const [error, setError] = useState<string>('');

        const validateAndCreateFolder = async () => {
          if (!newName.trim()) {
            setError(t('folder-name-required'));
            return;
          }

          const isDuplicate = currentResources.some(
            resource => resource.isFolder && resource.folderName?.toLowerCase() === newName.trim().toLowerCase()
          );

          if (isDuplicate) {
            setError(t('folder-name-exists'));
            return;
          }

          try {
            // Call backend API to create folder
            await PromiseCall(
              api.attachments.createFolder.mutate({
                folderName: newName.trim(),
                parentFolder: this.currentFolder || undefined
              })
            );
            
            // Refresh the resource list
            this.refreshTicker++;
            RootStore.Get(DialogStore).close();
          } catch (error) {
            setError(error.message || t('failed-to-create-folder'));
          }
        };

        return (
          <div className="flex flex-col gap-2 p-2">
            <Input
              label={t('folder-name')}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError('');
              }}
              errorMessage={error}
              isInvalid={!!error}
            />
            <Button
              color="primary"
              className="mt-2"
              onPress={validateAndCreateFolder}
              isDisabled={!newName.trim()}
            >
              {t('confirm')}
            </Button>
          </div>
        );
      }
    });
  };

  // Upload OS files (dragged from Finder/Explorer, or picked) into the folder
  // currently open in Resources. When a whole folder is dropped, each file
  // carries a relative path (react-dropzone sets `file.path`) so we recreate
  // the subfolder structure under the current folder. Folders in Resources are
  // derived from each file's `perfixPath`, so no placeholder rows are needed.
  uploadFiles = async (files: File[]) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    const baseSegs = this.currentFolder
      ? this.currentFolder.split('/').filter(Boolean)
      : [];

    let done = 0;
    let failed = 0;

    const doUpload = async () => {
      for (const file of list) {
        const rel = ((file as any).path || (file as any).webkitRelativePath || file.name) as string;
        const relDirSegs = rel.replace(/^\/+/, '').split('/').slice(0, -1).filter(Boolean);
        const folder = [...baseSegs, ...relDirSegs].join(',');

        const fd = new FormData();
        fd.append('file', file);
        if (folder) fd.append('folder', folder);

        try {
          await axiosInstance.post(getBlinkoEndpoint('/api/file/upload'), fd);
          done++;
        } catch (e) {
          failed++;
          console.error('resource upload failed', rel, e);
        }
      }
      if (failed > 0 && done === 0) throw new Error(`Upload failed (${failed} file${failed > 1 ? 's' : ''})`);
    };

    const where = this.currentFolder ? `"${this.currentFolder.split('/').pop()}"` : 'Resources';
    await RootStore.Get(ToastPlugin).promise(doUpload(), {
      loading: `Uploading ${list.length} file${list.length > 1 ? 's' : ''}…`,
      // Functions so the message reflects the final counts (react-hot-toast
      // evaluates these after the promise settles).
      success: () => failed > 0
        ? `Uploaded ${done} of ${list.length} to ${where}`
        : `Added ${done} file${done > 1 ? 's' : ''} to ${where}`,
      error: 'Upload failed',
    });

    this.refreshTicker++;
    this.clearSelection();
  };

  moveToParentFolder = async (items: ResourceType[]) => {
    if (!this.currentFolder) return;

    const folders = this.currentFolder.split('/');
    folders.pop();
    const parentFolder = folders.length > 0 ? folders.join(',') : '';

    await RootStore.Get(ToastPlugin).promise(
      PromiseCall(api.attachments.move.mutate({
        sourceIds: items.map(item => item.id!),
        targetFolder: parentFolder
      }), { autoAlert: false }),
      {
        loading: t("operation-in-progress"),
        success: t("operation-success"),
        error: t("operation-failed")
      }
    );
    this.refreshTicker++;
    this.clearSelection();
  };
}