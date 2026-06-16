-- AlterTable
ALTER TABLE "storeProfile" ADD COLUMN     "devServerPort" INTEGER NOT NULL DEFAULT 9292,
ADD COLUMN     "localThemePath" VARCHAR(500) NOT NULL DEFAULT 'theme';
