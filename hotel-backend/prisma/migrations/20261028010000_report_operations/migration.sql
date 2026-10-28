CREATE TABLE "HousekeepingWorker" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT NOT NULL,
 "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
 "language" TEXT NOT NULL DEFAULT 'en', "lastInboundAt" TIMESTAMP(3), "pendingProblemTaskId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "HousekeepingWorker_hotelId_phone_key" ON "HousekeepingWorker"("hotelId","phone");
CREATE TABLE "ReportTask" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "kind" TEXT NOT NULL, "reportDate" TEXT NOT NULL,
 "itemKey" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "data" JSONB NOT NULL,
 "sourceGeneratedAt" TIMESTAMP(3) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'New',
 "assignedWorkerId" TEXT, "assignmentId" TEXT, "assignedAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3),
 "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "problemType" TEXT, "problemNote" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ReportTask_hotelId_kind_reportDate_itemKey_key" ON "ReportTask"("hotelId","kind","reportDate","itemKey");
CREATE INDEX "ReportTask_hotelId_active_kind_idx" ON "ReportTask"("hotelId","active","kind");
CREATE INDEX "ReportTask_assignedWorkerId_status_idx" ON "ReportTask"("assignedWorkerId","status");
CREATE TABLE "HousekeepingAssignment" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "workerId" TEXT NOT NULL, "taskIds" JSONB NOT NULL,
 "requestKey" TEXT NOT NULL, "deliveryStatus" TEXT NOT NULL DEFAULT 'pending', "messageId" TEXT, "lastError" TEXT,
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HousekeepingAssignment_hotelId_requestKey_key" ON "HousekeepingAssignment"("hotelId","requestKey");
CREATE TABLE "ReportTaskEvent" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "taskId" TEXT NOT NULL, "actor" TEXT NOT NULL, "text" TEXT NOT NULL,
 "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReportTaskEvent_hotelId_taskId_at_idx" ON "ReportTaskEvent"("hotelId","taskId","at");
CREATE TABLE "HousekeepingConfig" ("hotelId" TEXT PRIMARY KEY, "templateName" TEXT, "templateLanguage" TEXT NOT NULL DEFAULT 'en_US');
