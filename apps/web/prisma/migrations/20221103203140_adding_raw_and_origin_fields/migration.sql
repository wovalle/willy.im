-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "origin" VARCHAR(30),
ADD COLUMN     "raw" JSONB;

-- AlterTable
ALTER TABLE "PageView" ADD COLUMN     "origin" VARCHAR(30),
ADD COLUMN     "raw" JSONB;
