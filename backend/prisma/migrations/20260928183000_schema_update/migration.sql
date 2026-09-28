-- CreateEnum
CREATE TYPE "WritebackType" AS ENUM ('INVOICE', 'STOCK_ENTRY');

-- CreateEnum
CREATE TYPE "WritebackStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'PO_RECEIVED', 'EXPIRED', 'REVISED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AmcContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AmcPlannedVisitStatus" AS ENUM ('PLANNED', 'CREATED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'VISIT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'QUOTATION_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'TICKET_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'WRITEBACK_SUCCEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'WRITEBACK_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'AMC_RENEWAL';

-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'ESCALATED';

-- CreateTable
CREATE TABLE "ErpWriteback" (
    "id" TEXT NOT NULL,
    "type" "WritebackType" NOT NULL,
    "status" "WritebackStatus" NOT NULL DEFAULT 'PENDING',
    "ticketId" TEXT,
    "visitId" TEXT,
    "quotationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "erpDocType" TEXT NOT NULL,
    "erpDocName" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "payload" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpWriteback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "visitNumber" INTEGER NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'DRAFT',
    "workDone" TEXT,
    "signatureKey" TEXT,
    "signatoryName" TEXT,
    "signatureRefused" BOOLEAN NOT NULL DEFAULT false,
    "refusalReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "createdById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitSpare" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitSpare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitPhoto" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "discountPercent" DECIMAL(5,2),
    "validUntil" DATE NOT NULL,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "poNumber" TEXT,
    "poDate" DATE,
    "poReceivedAt" TIMESTAMP(3),
    "revisesId" TEXT,
    "createdById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationCounter" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationCounter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "AmcContract" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "AmcContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "billingUnit" "BillingUnit" NOT NULL DEFAULT 'FIXED',
    "value" DECIMAL(14,2),
    "serviceTypeId" TEXT,
    "notes" TEXT,
    "preferredEngineerId" TEXT,
    "createdById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmcContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmcContractEquipment" (
    "contractId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmcContractEquipment_pkey" PRIMARY KEY ("contractId","equipmentId")
);

-- CreateTable
CREATE TABLE "AmcPlannedVisit" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "plannedOn" DATE NOT NULL,
    "ticketId" TEXT,
    "status" "AmcPlannedVisitStatus" NOT NULL DEFAULT 'PLANNED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmcPlannedVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmcContractCounter" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AmcContractCounter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "CsatToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "url" TEXT,
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsatToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsatResponse" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsatResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "ticketId" TEXT,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErpWriteback_idempotencyKey_key" ON "ErpWriteback"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ErpWriteback_ticketId_idx" ON "ErpWriteback"("ticketId");

-- CreateIndex
CREATE INDEX "ErpWriteback_status_idx" ON "ErpWriteback"("status");

-- CreateIndex
CREATE INDEX "Visit_ticketId_idx" ON "Visit"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_ticketId_visitNumber_key" ON "Visit"("ticketId", "visitNumber");

-- CreateIndex
CREATE INDEX "VisitSpare_visitId_idx" ON "VisitSpare"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitPhoto_storageKey_key" ON "VisitPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "VisitPhoto_visitId_idx" ON "VisitPhoto"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_number_key" ON "Quotation"("number");

-- CreateIndex
CREATE INDEX "Quotation_ticketId_idx" ON "Quotation"("ticketId");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "AmcContract_number_key" ON "AmcContract"("number");

-- CreateIndex
CREATE INDEX "AmcContract_customerId_idx" ON "AmcContract"("customerId");

-- CreateIndex
CREATE INDEX "AmcContract_status_idx" ON "AmcContract"("status");

-- CreateIndex
CREATE INDEX "AmcContractEquipment_equipmentId_idx" ON "AmcContractEquipment"("equipmentId");

-- CreateIndex
CREATE INDEX "AmcPlannedVisit_contractId_idx" ON "AmcPlannedVisit"("contractId");

-- CreateIndex
CREATE INDEX "AmcPlannedVisit_plannedOn_idx" ON "AmcPlannedVisit"("plannedOn");

-- CreateIndex
CREATE UNIQUE INDEX "CsatToken_tokenHash_key" ON "CsatToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CsatToken_ticketId_idx" ON "CsatToken"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "CsatResponse_tokenId_key" ON "CsatResponse"("tokenId");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- CreateIndex
CREATE INDEX "EmailLog_ticketId_idx" ON "EmailLog"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- AddForeignKey
ALTER TABLE "ErpWriteback" ADD CONSTRAINT "ErpWriteback_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpWriteback" ADD CONSTRAINT "ErpWriteback_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSpare" ADD CONSTRAINT "VisitSpare_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSpare" ADD CONSTRAINT "VisitSpare_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitPhoto" ADD CONSTRAINT "VisitPhoto_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitPhoto" ADD CONSTRAINT "VisitPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_revisesId_fkey" FOREIGN KEY ("revisesId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_preferredEngineerId_fkey" FOREIGN KEY ("preferredEngineerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContractEquipment" ADD CONSTRAINT "AmcContractEquipment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "AmcContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContractEquipment" ADD CONSTRAINT "AmcContractEquipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcPlannedVisit" ADD CONSTRAINT "AmcPlannedVisit_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "AmcContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcPlannedVisit" ADD CONSTRAINT "AmcPlannedVisit_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcPlannedVisit" ADD CONSTRAINT "AmcPlannedVisit_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsatToken" ADD CONSTRAINT "CsatToken_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "CsatToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
