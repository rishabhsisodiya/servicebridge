-- CreateEnum
CREATE TYPE "CustomerTokenType" AS ENUM ('MAGIC_LINK');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'APPROVAL';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomerContact" ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "approvedByCustomerAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "CustomerToken" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "CustomerTokenType" NOT NULL DEFAULT 'MAGIC_LINK',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerTemplateName" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "bodyText" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WhatsAppLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "ticketId" TEXT,
    "providerMessageId" TEXT,
    "status" "WhatsAppStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerToken_tokenHash_key" ON "CustomerToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerToken_contactId_type_idx" ON "CustomerToken"("contactId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerSession_contactId_revokedAt_idx" ON "CustomerSession"("contactId", "revokedAt");

-- CreateIndex
CREATE INDEX "CustomerSession_customerId_idx" ON "CustomerSession"("customerId");

-- CreateIndex
CREATE INDEX "WhatsAppLog_status_idx" ON "WhatsAppLog"("status");

-- CreateIndex
CREATE INDEX "WhatsAppLog_ticketId_idx" ON "WhatsAppLog"("ticketId");

-- CreateIndex
CREATE INDEX "WhatsAppLog_providerMessageId_idx" ON "WhatsAppLog"("providerMessageId");

-- AddForeignKey
ALTER TABLE "CustomerToken" ADD CONSTRAINT "CustomerToken_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "WhatsAppLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
