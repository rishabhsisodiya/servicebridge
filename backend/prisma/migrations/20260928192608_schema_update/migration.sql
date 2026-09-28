/*
  Warnings:

  - A unique constraint covering the columns `[partnerKeyId,externalRef]` on the table `Ticket` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ReportTrigger" AS ENUM ('MANUAL', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- AlterEnum
ALTER TYPE "RecordSource" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "partnerKeyId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "partnerKeyId" TEXT;

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "recipients" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT,
    "reportKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "trigger" "ReportTrigger" NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'RUNNING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "csvKey" TEXT,
    "error" TEXT,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSchedule_active_idx" ON "ReportSchedule"("active");

-- CreateIndex
CREATE INDEX "ReportRun_scheduleId_startedAt_idx" ON "ReportRun"("scheduleId", "startedAt");

-- CreateIndex
CREATE INDEX "ReportRun_status_idx" ON "ReportRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApiKey_keyHash_key" ON "PartnerApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "PartnerApiKey_createdById_idx" ON "PartnerApiKey"("createdById");

-- CreateIndex
CREATE INDEX "AuditLog_partnerKeyId_idx" ON "AuditLog"("partnerKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_partnerKeyId_externalRef_key" ON "Ticket"("partnerKeyId", "externalRef");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_partnerKeyId_fkey" FOREIGN KEY ("partnerKeyId") REFERENCES "PartnerApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_partnerKeyId_fkey" FOREIGN KEY ("partnerKeyId") REFERENCES "PartnerApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
