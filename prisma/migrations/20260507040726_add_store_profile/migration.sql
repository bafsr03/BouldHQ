-- CreateTable
CREATE TABLE "storeProfile" (
    "id" SERIAL NOT NULL,
    "tagId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "storeUrl" VARCHAR(500) NOT NULL DEFAULT '',
    "collabAccess" BOOLEAN NOT NULL DEFAULT false,
    "shopifyPlan" VARCHAR(50) NOT NULL DEFAULT '',
    "logoPath" VARCHAR(500) NOT NULL DEFAULT '',
    "renewalDate" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "storeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storeProfile_tagId_key" ON "storeProfile"("tagId");

-- CreateIndex
CREATE INDEX "storeProfile_accountId_idx" ON "storeProfile"("accountId");

-- AddForeignKey
ALTER TABLE "storeProfile" ADD CONSTRAINT "storeProfile_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
