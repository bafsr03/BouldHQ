// Smoke-test the auto-routing of uploads by filename.
//   - upload an attachment whose name contains a store name → routes to that
//     store's Branding Assets folder
//   - upload a generic name → stays put

import { PrismaClient } from '@prisma/client';
import { autoRouteUploadByFilename } from '../server/lib/bouldhq';

const p = new PrismaClient();

async function fakeAttachment(accountId: number, fileName: string) {
  const fakePath = `/api/file/__smoke_${Date.now()}_${Math.random().toString(36).slice(2)}_${fileName}`;
  return p.attachments.create({
    data: {
      accountId, name: fileName, path: fakePath,
      size: 100, type: 'image/png', perfixPath: '',
      isShare: false, sharePassword: '', sortOrder: 0,
    },
  });
}

async function main() {
  const account = await p.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!account) throw new Error('No account');

  // Pick a real store to test against.
  const store = await p.tag.findFirst({
    where: { teamId: 1, parent: 0, archivedAt: null, name: 'JCK.Approved' },
  });
  if (!store) throw new Error('Expected JCK.Approved store to exist');

  const created: number[] = [];
  try {
    // 1. Name mentions JCK.Approved exactly — should route.
    const a1 = await fakeAttachment(account.id, 'JCK.Approved_logo_v2.png');
    created.push(a1.id);
    const r1 = await autoRouteUploadByFilename(account.id, a1.path, a1.name);
    const after1 = await p.attachments.findUnique({ where: { id: a1.id } });

    // 2. Name mentions JCK as a prefix only — should still match (substring).
    const a2 = await fakeAttachment(account.id, 'jck-brand-guide.pdf');
    created.push(a2.id);
    const r2 = await autoRouteUploadByFilename(account.id, a2.path, a2.name);
    const after2 = await p.attachments.findUnique({ where: { id: a2.id } });

    // 3. Generic name with no store match — should NOT route.
    const a3 = await fakeAttachment(account.id, 'meeting-notes-q3.pdf');
    created.push(a3.id);
    const r3 = await autoRouteUploadByFilename(account.id, a3.path, a3.name);
    const after3 = await p.attachments.findUnique({ where: { id: a3.id } });

    console.log(JSON.stringify({
      exactMatch:    { matched: r1.matched, perfixPath: after1?.perfixPath, depth: after1?.depth },
      substringMatch:{ matched: r2.matched, perfixPath: after2?.perfixPath, depth: after2?.depth },
      noMatch:       { matched: r3.matched, perfixPath: after3?.perfixPath, depth: after3?.depth },
    }, null, 2));

    const ok =
      r1.matched === 'JCK.Approved' && after1?.perfixPath === 'Branding Assets,JCK.Approved' &&
      // substring match — at least one of the JCK-flavored stores should win
      r2.matched != null && after2?.perfixPath?.startsWith('Branding Assets,') &&
      r3.matched === null && (after3?.perfixPath ?? '') === '';

    console.log(ok ? '\n✓ auto-route smoke OK' : '\n✗ auto-route smoke FAILED');
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (created.length) await p.attachments.deleteMany({ where: { id: { in: created } } });
    await p.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
