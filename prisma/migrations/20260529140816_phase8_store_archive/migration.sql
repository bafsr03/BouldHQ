-- AlterTable
ALTER TABLE "tag" ADD COLUMN     "archivedAt" TIMESTAMPTZ(6),
ADD COLUMN     "archivedById" INTEGER;

-- CreateIndex
CREATE INDEX "tag_archivedAt_idx" ON "tag"("archivedAt");
