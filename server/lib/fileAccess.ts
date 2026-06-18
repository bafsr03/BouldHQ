// Permission helper for attachment serving (local + S3 routes).
//
// The per-account check in file.ts / s3file.ts was written before BouldHQ added
// team-wide note visibility and the brand-owner role. As a result, notes' image
// attachments 401 for everyone except the note's original author, even though
// the tRPC notes router happily returns the note body to teammates.
//
// This widens access so that:
//   - Any staff member of a team that owns a tag attached to the note can read.
//   - A brand_owner whose store (tagId) is one of the note's tags can read.
//
// Falls back to false if either lookup fails — caller still returns 401.

import { prisma } from '../prisma';

export async function hasNoteAccessByTeamOrBrand(
  noteId: number,
  accountId: number,
  role?: string,
): Promise<boolean> {
  if (!Number.isFinite(accountId) || accountId <= 0) return false;

  // Staff: is the caller a member of any team that owns a tag on this note?
  const teamHit = await prisma.tagsToNote.findFirst({
    where: {
      noteId,
      tag: { team: { members: { some: { accountId } } } },
    },
    select: { id: true },
  });
  if (teamHit) return true;

  // Brand owner: their store's tagId is one of the note's tags.
  if (role === 'brand_owner') {
    const owner = await prisma.brandOwner.findUnique({
      where: { accountId },
      select: { tagId: true },
    });
    if (owner) {
      const brandHit = await prisma.tagsToNote.findFirst({
        where: { noteId, tagId: owner.tagId },
        select: { id: true },
      });
      if (brandHit) return true;
    }
  }

  return false;
}
