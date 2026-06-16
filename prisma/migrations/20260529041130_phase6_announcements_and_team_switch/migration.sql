-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "lastActiveTeamId" INTEGER;

-- CreateTable
CREATE TABLE "announcement" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER,
    "authorId" INTEGER NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcement_teamId_createdAt_idx" ON "announcement"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "announcement_category_createdAt_idx" ON "announcement"("category", "createdAt");

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
