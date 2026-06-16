-- CreateTable
CREATE TABLE "brandOwner" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "phone" VARCHAR(40),
    "invitedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brandOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brandOwnerMagicLink" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brandOwnerMagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brandOwner_accountId_key" ON "brandOwner"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "brandOwner_tagId_key" ON "brandOwner"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "brandOwnerMagicLink_tokenHash_key" ON "brandOwnerMagicLink"("tokenHash");

-- CreateIndex
CREATE INDEX "brandOwnerMagicLink_ownerId_idx" ON "brandOwnerMagicLink"("ownerId");

-- AddForeignKey
ALTER TABLE "brandOwner" ADD CONSTRAINT "brandOwner_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brandOwner" ADD CONSTRAINT "brandOwner_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brandOwner" ADD CONSTRAINT "brandOwner_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brandOwnerMagicLink" ADD CONSTRAINT "brandOwnerMagicLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "brandOwner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
