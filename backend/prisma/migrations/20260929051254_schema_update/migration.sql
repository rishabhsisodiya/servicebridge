/*
  Warnings:

  - A unique constraint covering the columns `[ticketId]` on the table `CsatToken` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "CsatToken_ticketId_idx";

-- AlterTable
ALTER TABLE "CsatToken" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "resolutionBreachedEver" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "responseBreachedEver" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "CsatToken_ticketId_key" ON "CsatToken"("ticketId");
