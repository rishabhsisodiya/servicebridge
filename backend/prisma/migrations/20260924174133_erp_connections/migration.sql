-- CreateEnum
CREATE TYPE "ErpKind" AS ENUM ('FRAPPE');

-- CreateEnum
CREATE TYPE "ErpConnectionStatus" AS ENUM ('UNTESTED', 'ACTIVE', 'FAILING', 'DISABLED', 'KEY_ERROR');

-- CreateEnum
CREATE TYPE "ErpPurpose" AS ENUM ('MASTER_SYNC', 'DASHBOARDS', 'WRITEBACK');

-- CreateEnum
CREATE TYPE "ErpChannel" AS ENUM ('REST', 'DB');

-- CreateTable
CREATE TABLE "ErpConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ErpKind" NOT NULL DEFAULT 'FRAPPE',
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "apiKeyHint" TEXT NOT NULL,
    "apiSecretEnc" TEXT NOT NULL,
    "dbHost" TEXT,
    "dbPort" INTEGER,
    "dbName" TEXT,
    "dbUser" TEXT,
    "dbPasswordEnc" TEXT,
    "dbSsl" BOOLEAN NOT NULL DEFAULT true,
    "status" "ErpConnectionStatus" NOT NULL DEFAULT 'UNTESTED',
    "detailsChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erpVersion" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" JSONB,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ErpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpPurposeBinding" (
    "purpose" "ErpPurpose" NOT NULL,
    "connectionId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpPurposeBinding_pkey" PRIMARY KEY ("purpose")
);

-- CreateTable
CREATE TABLE "ErpRequestLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "channel" "ErpChannel" NOT NULL,
    "method" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "doctype" TEXT,
    "httpStatus" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "error" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErpConnection_name_key" ON "ErpConnection"("name");

-- CreateIndex
CREATE INDEX "ErpRequestLog_connectionId_createdAt_idx" ON "ErpRequestLog"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "ErpRequestLog_ok_createdAt_idx" ON "ErpRequestLog"("ok", "createdAt");

-- AddForeignKey
ALTER TABLE "ErpPurposeBinding" ADD CONSTRAINT "ErpPurposeBinding_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpRequestLog" ADD CONSTRAINT "ErpRequestLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
