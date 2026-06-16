// BouldHQ — lets the AI save a generated document (HTML / Markdown / text)
// into the team's Resources panel. Used by /report to drop a brand-aware
// HTML report under Branding Assets/<store>/Reports/, but works for any
// destination folder.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v3';
import { prisma } from '@server/prisma';
import { FileService } from '@server/lib/files';
import { verifyToken } from '@server/lib/helper';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
};

function inferMime(filename: string, override?: string): string {
  if (override) return override;
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function normalizeFolderPath(p?: string): string {
  if (!p) return '';
  // Accept either "Branding Assets,Joon,Reports" or "Branding Assets/Joon/Reports".
  return p.split(/[\/,]/).map((s) => s.trim()).filter(Boolean).join(',');
}

async function ensureFolderRow(accountId: number, perfixPath: string): Promise<void> {
  if (!perfixPath) return;
  const segments = perfixPath.split(',');
  // Walk every prefix so each level is a real folder row.
  for (let i = 1; i <= segments.length; i++) {
    const path = segments.slice(0, i).join(',');
    const folderName = segments[i - 1];
    const exists = await prisma.attachments.findFirst({
      where: { accountId, type: 'folder', perfixPath: path, name: '.folder' },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.attachments.create({
      data: {
        path: `/api/file/${segments.slice(0, i).join('/')}/.folder`,
        name: '.folder',
        size: 0,
        type: 'folder',
        perfixPath: path,
        depth: i,
        accountId,
        isShare: false,
        sharePassword: '',
        sortOrder: 0,
      },
    });
  }
}

export const createResourceFileTool = createTool({
  id: 'bouldhq-create-resource-file',
  description:
    'Save a new file (HTML, Markdown, or plain text) into the team\'s Resources. ' +
    'Use this to create reports, manuals, briefs, or any document you generated. ' +
    'Specify folderPath as a comma- or slash-separated path like "Branding Assets,Joon,Reports". ' +
    'The folder will be created if it doesn\'t exist.',
  //@ts-ignore
  inputSchema: z.object({
    filename: z
      .string()
      .min(1)
      .describe('File name with extension, e.g. "joon-weekly-2026-06-14.html"'),
    content: z.string().min(1).describe('Raw file contents (UTF-8 text).'),
    folderPath: z
      .string()
      .optional()
      .describe(
        'Destination folder, comma- or slash-separated. Examples: "Branding Assets,Joon,Reports", "BouldHQ/Manuals". Empty = Resources root.',
      ),
    mimeType: z
      .string()
      .optional()
      .describe('Optional MIME type override. Inferred from filename if omitted.'),
    description: z
      .string()
      .optional()
      .describe('Optional metadata note attached to the attachment.'),
    token: z.string().optional().describe('internal use, do not pass!'),
  }),
  execute: async ({ context, runtimeContext }) => {
    const accountIdRaw =
      runtimeContext?.get('accountId') ?? (await verifyToken(context.token))?.sub;
    const accountId = Number(accountIdRaw);
    if (!accountId || Number.isNaN(accountId)) {
      return { success: false, message: 'Could not resolve account id' };
    }

    const folderPath = normalizeFolderPath(context.folderPath);
    const mime = inferMime(context.filename, context.mimeType);
    const buffer = Buffer.from(context.content, 'utf-8');

    try {
      // Make sure each folder level exists so the file isn't orphaned in an
      // empty-looking folder. Idempotent.
      if (folderPath) await ensureFolderRow(accountId, folderPath);

      // Write bytes + create the attachment row (handles S3 / local).
      const { filePath, fileName } = await FileService.uploadFile({
        buffer,
        originalName: context.filename,
        type: mime,
        accountId,
        metadata: context.description ? { description: context.description } : undefined,
      });

      // Move into the requested folder if one was given.
      if (folderPath) {
        const segments = folderPath.split(',');
        await prisma.attachments.updateMany({
          where: { path: filePath, accountId },
          data: { perfixPath: folderPath, depth: segments.length + 1 },
        });
      }

      return {
        success: true,
        path: filePath,
        name: fileName,
        folder: folderPath || '(root)',
        mimeType: mime,
        size: buffer.length,
        message: `Saved "${fileName}" to Resources${folderPath ? ` › ${folderPath.replace(/,/g, ' › ')}` : ''}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to create resource file',
      };
    }
  },
});
