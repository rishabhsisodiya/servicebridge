-- CreateEnum
CREATE TYPE "DutyStatus" AS ENUM ('ON_DUTY', 'OFF_DUTY', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TICKET_NEW', 'TICKET_UNROUTED', 'TICKET_ASSIGNED', 'TICKET_UNASSIGNED', 'TICKET_DECLINED', 'TICKET_RESOLVED', 'TICKET_SENT_BACK', 'SLA_AT_RISK', 'SLA_BREACHED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dutyChangedAt" TIMESTAMP(3),
ADD COLUMN     "dutyStatus" "DutyStatus" NOT NULL DEFAULT 'ON_DUTY';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "ticketId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
