-- CreateEnum
CREATE TYPE "JobTrigger" AS ENUM ('SCHEDULE', 'MANUAL', 'EVENT');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "AutomationSetting" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "cron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "params" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "automationKey" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobId" TEXT,
    "trigger" "JobTrigger" NOT NULL,
    "actorId" TEXT,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_automationKey_startedAt_idx" ON "JobRun"("automationKey", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");
