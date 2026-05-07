-- AlterTable
ALTER TABLE "storeProfile" ADD COLUMN     "adminUrl" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "collaboratorCode" VARCHAR(20) NOT NULL DEFAULT '';
