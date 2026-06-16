// BouldHQ — destructive Resources tools the assistant uses to keep folders
// tidy. These are exposed ONLY through the founder-gated BouldHqAssistant.
// They mutate the attachments table directly (with explicit auth checks) so
// the AI can clean up duplicate folders, move misfiled assets, and delete
// unused content without bouncing through the regular tRPC endpoints.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v3';
import { prisma } from '@server/prisma';
import { FileService } from '@server/lib/files';
import { verifyToken } from '@server/lib/helper';

async function resolveAccountId(runtimeContext: any, token?: string): Promise<number | null> {
  const id = runtimeContext?.get('accountId') ?? (await verifyToken(token!))?.sub;
  const n = Number(id);
  return n && !Number.isNaN(n) ? n : null;
}

// Set of accountIds whose Resources the caller can see — themselves plus
// everyone else on any team they belong to. Mirrors the visibility used by
// the attachments router.
async function visibleAccountIds(callerId: number): Promise<number[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { accountId: callerId },
    select: { teamId: true },
  });
  if (memberships.length === 0) return [callerId];
  const teamIds = memberships.map((m) => m.teamId);
  const mates = await prisma.teamMember.findMany({
    where: { teamId: { in: teamIds } },
    select: { accountId: true },
  });
  return Array.from(new Set<number>([callerId, ...mates.map((m) => m.accountId)]));
}

function normalizeFolderPath(p?: string): string {
  if (!p) return '';
  return p.split(/[\/,]/).map((s) => s.trim()).filter(Boolean).join(',');
}

// -----------------------------------------------------------------------------

export const listFoldersTool = createTool({
  id: 'bouldhq-list-folders',
  description:
    'List every folder in the team\'s Resources panel with its full path and how many files live under it. ' +
    'Use this before deleting or moving content so you know what you\'re working with. ' +
    'Returns folders grouped by their comma-separated path (e.g. "Branding Assets,Joon,Reports").',
  //@ts-ignore
  inputSchema: z.object({
    pathPrefix: z
      .string()
      .optional()
      .describe('Optional path prefix to scope the listing, e.g. "Branding Assets" to only see store folders.'),
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const accountId = await resolveAccountId(runtimeContext, context.token);
    if (!accountId) return { success: false, message: 'Could not resolve account' };
    const ids = await visibleAccountIds(accountId);
    const prefix = normalizeFolderPath(context.pathPrefix);

    const folders = await prisma.attachments.findMany({
      where: {
        accountId: { in: ids },
        type: 'folder',
        name: '.folder',
        ...(prefix ? { perfixPath: { startsWith: prefix } } : {}),
      },
      select: { id: true, perfixPath: true },
      orderBy: { perfixPath: 'asc' },
    });

    // Count files per folder.
    const paths = folders.map((f) => f.perfixPath).filter(Boolean) as string[];
    const counts = await prisma.attachments.groupBy({
      by: ['perfixPath'],
      where: {
        accountId: { in: ids },
        perfixPath: { in: paths },
        type: { not: 'folder' },
      },
      _count: { _all: true },
    });
    const countByPath = new Map(counts.map((c) => [c.perfixPath, c._count._all]));

    return {
      success: true,
      folders: folders.map((f) => ({
        id: f.id,
        path: f.perfixPath || '',
        name: (f.perfixPath || '').split(',').slice(-1)[0] || '',
        fileCount: countByPath.get(f.perfixPath!) ?? 0,
      })),
    };
  },
});

// -----------------------------------------------------------------------------

export const deleteResourceTool = createTool({
  id: 'bouldhq-delete-resource',
  description:
    'Delete a file or a folder from Resources. Pass either { attachmentId } to delete a single file, ' +
    'or { folderPath } to delete a folder AND every file inside it (cascading). ' +
    'Use bouldhq-list-folders first to see what exists. Destructive — does not ask for confirmation.',
  //@ts-ignore
  inputSchema: z.object({
    attachmentId: z.number().optional().describe('Delete a single file by its attachment id.'),
    folderPath: z
      .string()
      .optional()
      .describe('Delete a folder (and all files inside it). Use comma- or slash-separated path. Example: "Branding Assets,STORETEST".'),
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const accountId = await resolveAccountId(runtimeContext, context.token);
    if (!accountId) return { success: false, message: 'Could not resolve account' };
    const ids = await visibleAccountIds(accountId);

    // Single-file delete
    if (context.attachmentId) {
      const target = await prisma.attachments.findFirst({
        where: { id: context.attachmentId, accountId: { in: ids } },
      });
      if (!target) return { success: false, message: 'File not found or not accessible' };
      try {
        await FileService.deleteFile(target.path);
      } catch (err: any) {
        // deleteFile already removes the DB row, but if the file is missing
        // we still want to clear the row.
        try {
          await prisma.attachments.delete({ where: { id: target.id } });
        } catch { /* already gone */ }
      }
      return {
        success: true,
        deleted: { id: target.id, name: target.name, path: target.path },
        message: `Deleted "${target.name}"`,
      };
    }

    // Folder cascade delete
    const folderPath = normalizeFolderPath(context.folderPath);
    if (!folderPath) {
      return { success: false, message: 'Pass either attachmentId or folderPath.' };
    }

    // Match the folder itself + everything inside (any nested subfolder too).
    const targets = await prisma.attachments.findMany({
      where: {
        accountId: { in: ids },
        OR: [
          { perfixPath: folderPath },
          { perfixPath: { startsWith: folderPath + ',' } },
        ],
      },
      select: { id: true, name: true, path: true, type: true },
    });

    if (targets.length === 0) {
      return { success: false, message: `No folder named "${folderPath.replace(/,/g, ' › ')}" found` };
    }

    let deletedFiles = 0;
    let deletedFolders = 0;
    const errors: string[] = [];

    for (const t of targets) {
      try {
        if (t.type === 'folder') {
          await prisma.attachments.delete({ where: { id: t.id } });
          deletedFolders++;
        } else {
          await FileService.deleteFile(t.path);
          deletedFiles++;
        }
      } catch (err: any) {
        errors.push(`${t.name}: ${err?.message || 'failed'}`);
        // Best-effort: drop the DB row even if the file delete failed.
        try {
          await prisma.attachments.delete({ where: { id: t.id } });
        } catch { /* already gone */ }
      }
    }

    return {
      success: errors.length === 0,
      folderPath,
      deletedFiles,
      deletedFolders,
      errors,
      message:
        `Deleted folder "${folderPath.replace(/,/g, ' › ')}" — ` +
        `${deletedFiles} file${deletedFiles === 1 ? '' : 's'} and ${deletedFolders} folder row${deletedFolders === 1 ? '' : 's'}` +
        (errors.length ? ` (${errors.length} errors)` : ''),
    };
  },
});

// -----------------------------------------------------------------------------

export const moveResourceTool = createTool({
  id: 'bouldhq-move-resource',
  description:
    'Move one or more files to a different folder in Resources. Pass attachmentIds (array of file ids) and ' +
    'targetFolderPath (comma- or slash-separated). Creates the target folder if it doesn\'t exist. ' +
    'Use this to merge duplicate folders by moving files from the unused one into the canonical one, ' +
    'then bouldhq-delete-resource the empty original.',
  //@ts-ignore
  inputSchema: z.object({
    attachmentIds: z.array(z.number()).min(1).describe('IDs of the files to move.'),
    targetFolderPath: z
      .string()
      .describe('Destination folder path, comma- or slash-separated. Example: "Branding Assets,Joon". Created if missing.'),
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const accountId = await resolveAccountId(runtimeContext, context.token);
    if (!accountId) return { success: false, message: 'Could not resolve account' };
    const ids = await visibleAccountIds(accountId);
    const targetPath = normalizeFolderPath(context.targetFolderPath);
    if (!targetPath) return { success: false, message: 'targetFolderPath is required' };

    const attachments = await prisma.attachments.findMany({
      where: {
        id: { in: context.attachmentIds },
        accountId: { in: ids },
        type: { not: 'folder' },
      },
      select: { id: true, name: true },
    });
    if (attachments.length === 0) {
      return { success: false, message: 'No accessible files matched those ids' };
    }

    // Ensure each path segment exists as a folder row so the destination is
    // visible in the UI.
    const segments = targetPath.split(',');
    for (let i = 1; i <= segments.length; i++) {
      const p = segments.slice(0, i).join(',');
      const exists = await prisma.attachments.findFirst({
        where: { accountId, type: 'folder', perfixPath: p, name: '.folder' },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.attachments.create({
        data: {
          path: `/api/file/${segments.slice(0, i).join('/')}/.folder`,
          name: '.folder',
          size: 0,
          type: 'folder',
          perfixPath: p,
          depth: i,
          accountId,
          isShare: false,
          sharePassword: '',
          sortOrder: 0,
        },
      });
    }

    await prisma.attachments.updateMany({
      where: { id: { in: attachments.map((a) => a.id) } },
      data: { perfixPath: targetPath, depth: segments.length + 1 },
    });

    return {
      success: true,
      moved: attachments.length,
      targetFolder: targetPath,
      message: `Moved ${attachments.length} file${attachments.length === 1 ? '' : 's'} to ${targetPath.replace(/,/g, ' › ')}`,
    };
  },
});

// -----------------------------------------------------------------------------

export const renameResourceTool = createTool({
  id: 'bouldhq-rename-resource',
  description:
    'Rename a file (changes its filename) or rename a folder (rewrites the path segment for the folder and ' +
    'every file inside it). For folders, pass folderPath + newFolderName. For files, pass attachmentId + newName.',
  //@ts-ignore
  inputSchema: z.object({
    attachmentId: z.number().optional().describe('File id to rename.'),
    newName: z.string().optional().describe('New filename when renaming a file.'),
    folderPath: z.string().optional().describe('Existing folder path (comma or slash separated).'),
    newFolderName: z.string().optional().describe('New name for the last segment of the folder path.'),
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const accountId = await resolveAccountId(runtimeContext, context.token);
    if (!accountId) return { success: false, message: 'Could not resolve account' };
    const ids = await visibleAccountIds(accountId);

    // File rename
    if (context.attachmentId && context.newName) {
      const att = await prisma.attachments.findFirst({
        where: { id: context.attachmentId, accountId: { in: ids } },
      });
      if (!att) return { success: false, message: 'File not found' };
      try {
        await FileService.renameFile(att.path, context.newName);
        await prisma.attachments.update({
          where: { id: att.id },
          data: {
            name: context.newName,
            path: att.path.replace(att.name, context.newName),
          },
        });
        return { success: true, message: `Renamed to "${context.newName}"` };
      } catch (err: any) {
        return { success: false, message: err?.message || 'rename failed' };
      }
    }

    // Folder rename
    const oldPath = normalizeFolderPath(context.folderPath);
    const newSegment = context.newFolderName?.trim();
    if (oldPath && newSegment) {
      const segs = oldPath.split(',');
      segs[segs.length - 1] = newSegment;
      const newPath = segs.join(',');

      const targets = await prisma.attachments.findMany({
        where: {
          accountId: { in: ids },
          OR: [
            { perfixPath: oldPath },
            { perfixPath: { startsWith: oldPath + ',' } },
          ],
        },
        select: { id: true, perfixPath: true },
      });

      for (const t of targets) {
        const updated = (t.perfixPath || '').replace(oldPath, newPath);
        await prisma.attachments.update({
          where: { id: t.id },
          data: { perfixPath: updated, depth: updated.split(',').length },
        });
      }

      return {
        success: true,
        renamed: targets.length,
        message: `Renamed folder "${oldPath.replace(/,/g, ' › ')}" → "${newPath.replace(/,/g, ' › ')}"`,
      };
    }

    return {
      success: false,
      message: 'Pass attachmentId+newName for a file, or folderPath+newFolderName for a folder.',
    };
  },
});
