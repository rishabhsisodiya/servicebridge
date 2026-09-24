-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('DEMO', 'ERP', 'LOCAL');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('QUEUED', 'PROCESSED', 'IGNORED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "ErpConnection" ADD COLUMN     "webhookSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "name" TEXT NOT NULL,
    "customerGroup" TEXT,
    "territory" TEXT,
    "taxId" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "customerId" TEXT,
    "customerErpName" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "customerId" TEXT,
    "customerErpName" TEXT,
    "title" TEXT NOT NULL,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "country" TEXT,
    "gstin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "serialNo" TEXT NOT NULL,
    "itemCode" TEXT,
    "itemName" TEXT,
    "customerId" TEXT,
    "customerErpName" TEXT,
    "erpStatus" TEXT,
    "warrantyExpiresOn" DATE,
    "amcExpiresOn" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemGroup" TEXT,
    "uom" TEXT,
    "isStockItem" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPrice" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "itemCode" TEXT NOT NULL,
    "priceList" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "selling" BOOLEAN NOT NULL DEFAULT true,
    "buying" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL,
    "erpConnectionId" TEXT,
    "erpName" TEXT,
    "itemCode" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "actualQty" DECIMAL(18,4) NOT NULL,
    "projectedQty" DECIMAL(18,4) NOT NULL,
    "erpModified" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "key" TEXT NOT NULL,
    "lastModified" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ErpWebhookEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "doctype" TEXT,
    "docName" TEXT,
    "event" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "status" "WebhookEventStatus" NOT NULL,
    "detail" TEXT,
    "jobId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ErpWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_erpConnectionId_erpName_key" ON "Customer"("erpConnectionId", "erpName");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerContact_erpConnectionId_erpName_key" ON "CustomerContact"("erpConnectionId", "erpName");

-- CreateIndex
CREATE INDEX "Site_customerId_idx" ON "Site"("customerId");

-- CreateIndex
CREATE INDEX "Site_pincode_idx" ON "Site"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX "Site_erpConnectionId_erpName_key" ON "Site"("erpConnectionId", "erpName");

-- CreateIndex
CREATE INDEX "Equipment_serialNo_idx" ON "Equipment"("serialNo");

-- CreateIndex
CREATE INDEX "Equipment_customerId_idx" ON "Equipment"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_erpConnectionId_erpName_key" ON "Equipment"("erpConnectionId", "erpName");

-- CreateIndex
CREATE INDEX "Item_itemCode_idx" ON "Item"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "Item_erpConnectionId_erpName_key" ON "Item"("erpConnectionId", "erpName");

-- CreateIndex
CREATE INDEX "ItemPrice_itemCode_priceList_idx" ON "ItemPrice"("itemCode", "priceList");

-- CreateIndex
CREATE UNIQUE INDEX "ItemPrice_erpConnectionId_erpName_key" ON "ItemPrice"("erpConnectionId", "erpName");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_erpConnectionId_erpName_key" ON "Warehouse"("erpConnectionId", "erpName");

-- CreateIndex
CREATE INDEX "StockLevel_itemCode_idx" ON "StockLevel"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_erpConnectionId_erpName_key" ON "StockLevel"("erpConnectionId", "erpName");

-- CreateIndex
CREATE INDEX "ErpWebhookEvent_connectionId_receivedAt_idx" ON "ErpWebhookEvent"("connectionId", "receivedAt");

-- CreateIndex
CREATE INDEX "ErpWebhookEvent_status_receivedAt_idx" ON "ErpWebhookEvent"("status", "receivedAt");

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpWebhookEvent" ADD CONSTRAINT "ErpWebhookEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
