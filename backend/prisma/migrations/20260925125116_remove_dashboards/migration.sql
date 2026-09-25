/*
  Warnings:

  - The values [DASHBOARDS] on the enum `ErpPurpose` will be removed. If these variants are still used in the database, this will fail.
  - The values [DEPARTMENT_HEAD] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.

*/
-- Data that still uses the removed values (added by hand).
-- The dashboards purpose no longer exists, so its connection choice is dropped.
DELETE FROM "ErpPurposeBinding" WHERE "purpose" = 'DASHBOARDS';
-- Department heads become deactivated executives: no one gains access until an admin decides.
UPDATE "User"
SET "role" = 'EXECUTIVE', "status" = 'DEACTIVATED', "version" = "version" + 1
WHERE "role" = 'DEPARTMENT_HEAD';

-- AlterEnum
BEGIN;
CREATE TYPE "ErpPurpose_new" AS ENUM ('MASTER_SYNC', 'WRITEBACK');
ALTER TABLE "ErpPurposeBinding" ALTER COLUMN "purpose" TYPE "ErpPurpose_new" USING ("purpose"::text::"ErpPurpose_new");
ALTER TYPE "ErpPurpose" RENAME TO "ErpPurpose_old";
ALTER TYPE "ErpPurpose_new" RENAME TO "ErpPurpose";
DROP TYPE "ErpPurpose_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'SERVICE_MANAGER', 'AREA_MANAGER', 'ENGINEER', 'CALL_CENTER', 'CS_SUPPORT', 'EXECUTIVE');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
COMMIT;
