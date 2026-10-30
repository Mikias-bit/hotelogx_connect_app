ALTER TABLE "ReportTask"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'report',
  ADD COLUMN "overrides" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "pendingSourceData" JSONB,
  ADD COLUMN "sourcePresent" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sourceReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "planVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "notBefore" TIMESTAMP(3),
  ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "HousekeepingConfig" ADD COLUMN "changeTemplateName" TEXT;
CREATE TABLE "HousekeepingPlanChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "hotelId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "planVersion" INTEGER NOT NULL,
  "workerId" TEXT,
  "workerPhone" TEXT,
  "assignmentId" TEXT,
  "details" JSONB NOT NULL,
  "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
  "messageId" TEXT,
  "lastError" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HousekeepingPlanChange_hotelId_requestKey_key" ON "HousekeepingPlanChange"("hotelId", "requestKey");
CREATE INDEX "HousekeepingPlanChange_hotelId_taskId_createdAt_idx" ON "HousekeepingPlanChange"("hotelId", "taskId", "createdAt");
