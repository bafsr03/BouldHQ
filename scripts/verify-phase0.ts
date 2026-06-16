import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const [teams, members, tagsWithTeam, tagsWithoutTeam, topLevelTags, founder] = await Promise.all([
  p.team.count(),
  p.teamMember.count(),
  p.tag.count({ where: { teamId: { not: null } } }),
  p.tag.count({ where: { teamId: null } }),
  p.tag.count({ where: { parent: 0 } }),
  p.teamMember.findFirst({
    include: {
      account: { select: { id: true, name: true } },
      team: { select: { slug: true, name: true } },
    },
  }),
]);
console.log(JSON.stringify({ teams, members, tagsWithTeam, tagsWithoutTeam, topLevelTags, founder }, null, 2));
await p.$disconnect();
