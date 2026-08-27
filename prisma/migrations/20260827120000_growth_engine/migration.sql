-- BouldHQ Growth Engine — accountability tracker behind /growth.

-- CreateTable
CREATE TABLE "growthCheck" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL DEFAULT 0,
    "scope" VARCHAR(10) NOT NULL,
    "taskId" VARCHAR(40) NOT NULL,
    "checkedById" INTEGER,
    "checkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growthTrack" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL DEFAULT 0,
    "blueprint" VARCHAR(10) NOT NULL DEFAULT '',
    "cycleStart" VARCHAR(10) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growthTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growthCheck_teamId_tagId_idx" ON "growthCheck"("teamId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "growthCheck_teamId_tagId_scope_taskId_key" ON "growthCheck"("teamId", "tagId", "scope", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "growthTrack_teamId_tagId_key" ON "growthTrack"("teamId", "tagId");

-- AddForeignKey
ALTER TABLE "growthCheck" ADD CONSTRAINT "growthCheck_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growthCheck" ADD CONSTRAINT "growthCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growthTrack" ADD CONSTRAINT "growthTrack_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
