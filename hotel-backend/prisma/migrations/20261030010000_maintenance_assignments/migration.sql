ALTER TABLE "Task"
 ADD COLUMN "assignedWorkerId" TEXT,
 ADD COLUMN "assignmentId" TEXT,
 ADD COLUMN "assignedAt" TIMESTAMP(3),
 ADD COLUMN "acceptedAt" TIMESTAMP(3),
 ADD COLUMN "startedAt" TIMESTAMP(3),
 ADD COLUMN "completedAt" TIMESTAMP(3),
 ADD COLUMN "problemNote" TEXT,
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Issue"
 ADD COLUMN "assignedWorkerId" TEXT,
 ADD COLUMN "assignmentId" TEXT,
 ADD COLUMN "assignedAt" TIMESTAMP(3),
 ADD COLUMN "acceptedAt" TIMESTAMP(3),
 ADD COLUMN "startedAt" TIMESTAMP(3),
 ADD COLUMN "completedAt" TIMESTAMP(3),
 ADD COLUMN "problemNote" TEXT,
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "MaintenanceWorker" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT NOT NULL,
 "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
 "language" TEXT NOT NULL DEFAULT 'en', "lastInboundAt" TIMESTAMP(3), "pendingProblemRef" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "MaintenanceWorker_hotelId_phone_key" ON "MaintenanceWorker"("hotelId", "phone");
CREATE TABLE "MaintenanceAssignment" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "workerId" TEXT NOT NULL, "work" JSONB NOT NULL,
 "requestKey" TEXT NOT NULL, "deliveryStatus" TEXT NOT NULL DEFAULT 'pending', "messageId" TEXT,
 "lastError" TEXT, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MaintenanceAssignment_hotelId_requestKey_key" ON "MaintenanceAssignment"("hotelId", "requestKey");
CREATE INDEX "MaintenanceAssignment_hotelId_createdAt_idx" ON "MaintenanceAssignment"("hotelId", "createdAt");
CREATE TABLE "MaintenanceConfig" (
 "hotelId" TEXT PRIMARY KEY, "templateName" TEXT, "templateLanguage" TEXT NOT NULL DEFAULT 'en_US'
);
