-- AlterTable
ALTER TABLE "tag" ADD COLUMN     "teamId" INTEGER;

-- CreateTable
CREATE TABLE "team" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teamMember" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storeRequest" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "assigneeId" INTEGER,
    "source" VARCHAR(20) NOT NULL,
    "rawBody" TEXT NOT NULL,
    "attachmentIds" INTEGER[],
    "triageResult" JSONB,
    "status" VARCHAR(30) NOT NULL,
    "jobId" VARCHAR(100),
    "managerNotes" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "storeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_slug_key" ON "team"("slug");

-- CreateIndex
CREATE INDEX "teamMember_accountId_idx" ON "teamMember"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "teamMember_teamId_accountId_key" ON "teamMember"("teamId", "accountId");

-- CreateIndex
CREATE INDEX "storeRequest_teamId_status_idx" ON "storeRequest"("teamId", "status");

-- CreateIndex
CREATE INDEX "storeRequest_tagId_idx" ON "storeRequest"("tagId");

-- CreateIndex
CREATE INDEX "storeRequest_assigneeId_idx" ON "storeRequest"("assigneeId");

-- CreateIndex
CREATE INDEX "tag_teamId_idx" ON "tag"("teamId");

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storeRequest" ADD CONSTRAINT "storeRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storeRequest" ADD CONSTRAINT "storeRequest_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storeRequest" ADD CONSTRAINT "storeRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storeRequest" ADD CONSTRAINT "storeRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- BouldHQ Phase 0 backfill
-- Idempotent: safe to re-run; guards on existence so dev/staging/prod all converge.
-- ============================================================================

-- 1. Default team
INSERT INTO "team" ("name", "slug", "description", "updatedAt")
SELECT 'BouldHQ', 'bouldhq', 'Default team — seeded by Phase 0 migration.', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "team" WHERE "slug" = 'bouldhq');

-- 2. Promote the oldest existing account to founder of the default team.
--    Other accounts (if any) get no membership and must be invited explicitly.
INSERT INTO "teamMember" ("teamId", "accountId", "role")
SELECT
  (SELECT "id" FROM "team" WHERE "slug" = 'bouldhq'),
  (SELECT "id" FROM "accounts" ORDER BY "id" ASC LIMIT 1),
  'founder'
WHERE
  EXISTS (SELECT 1 FROM "accounts")
  AND NOT EXISTS (
    SELECT 1 FROM "teamMember"
    WHERE "teamId" = (SELECT "id" FROM "team" WHERE "slug" = 'bouldhq')
      AND "accountId" = (SELECT "id" FROM "accounts" ORDER BY "id" ASC LIMIT 1)
  );

-- 3. Assign every existing tag (stores + descendant tags) to the default team.
UPDATE "tag"
   SET "teamId" = (SELECT "id" FROM "team" WHERE "slug" = 'bouldhq')
 WHERE "teamId" IS NULL;
