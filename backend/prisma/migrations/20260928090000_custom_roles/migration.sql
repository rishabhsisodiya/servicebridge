-- Custom roles: the fixed "Role" enum becomes a table admins can edit.
-- Existing users move to built-in roles with exactly the access they had.
-- Built-in rows must match BUILT_IN_ROLES in src/auth/permissions.ts (checked by a spec).

-- Free the name "Role" for the new table; the old enum is dropped at the end.
ALTER TYPE "Role" RENAME TO "Role_old";

-- CreateEnum
CREATE TYPE "TicketScope" AS ENUM ('ALL', 'REGION', 'OWN');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "ticketScope" "TicketScope" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- Built-in roles
INSERT INTO "Role" ("id", "key", "name", "isLocked", "permissions", "ticketScope", "updatedAt") VALUES
  ('role_admin', 'ADMIN', 'Administrator', true, ARRAY[]::TEXT[], 'ALL', CURRENT_TIMESTAMP),
  ('role_service_manager', 'SERVICE_MANAGER', 'Service manager', false,
    ARRAY['tickets.read', 'customers.read', 'equipment.read', 'items.read', 'tickets.create', 'tickets.edit', 'tickets.assign', 'tickets.verify', 'tickets.escalations', 'amc.read', 'amc.edit', 'quotations.edit', 'reports.read', 'reports.schedule'],
    'ALL', CURRENT_TIMESTAMP),
  ('role_area_manager', 'AREA_MANAGER', 'Area manager', false,
    ARRAY['tickets.read', 'customers.read', 'equipment.read', 'items.read', 'tickets.create', 'tickets.edit', 'tickets.assign', 'tickets.verify', 'amc.read'],
    'REGION', CURRENT_TIMESTAMP),
  ('role_engineer', 'ENGINEER', 'Service engineer', false,
    ARRAY['tickets.read', 'tickets.work', 'equipment.read', 'items.read'],
    'OWN', CURRENT_TIMESTAMP),
  ('role_call_center', 'CALL_CENTER', 'Call center', false,
    ARRAY['tickets.read', 'customers.read', 'equipment.read', 'items.read', 'tickets.create', 'tickets.edit'],
    'ALL', CURRENT_TIMESTAMP),
  ('role_cs_support', 'CS_SUPPORT', 'Customer support', false,
    ARRAY['tickets.read', 'customers.read', 'equipment.read', 'items.read', 'amc.read', 'amc.edit', 'quotations.edit'],
    'ALL', CURRENT_TIMESTAMP),
  ('role_executive', 'EXECUTIVE', 'Executive', false,
    ARRAY['tickets.read', 'reports.read'],
    'ALL', CURRENT_TIMESTAMP);

-- Move users onto the table
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;
UPDATE "User" SET "roleId" = 'role_' || lower("role"::text);
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;

-- DropIndex
DROP INDEX "User_role_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role";

-- DropEnum
DROP TYPE "Role_old";

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
