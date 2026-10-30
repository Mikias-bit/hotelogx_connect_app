ALTER TABLE "Issue" ADD COLUMN "faultKey" TEXT,
  ADD COLUMN "housekeepingReported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "repairCycle" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "followUpTaskId" TEXT;
CREATE TABLE "RoomReadiness" (
  "hotelId" TEXT NOT NULL, "roomNumber" TEXT NOT NULL,
  "occupied" BOOLEAN NOT NULL DEFAULT false, "needsCleaning" BOOLEAN NOT NULL DEFAULT false, "dnd" BOOLEAN NOT NULL DEFAULT false,
  "maintenanceBlocked" BOOLEAN NOT NULL DEFAULT false, "otherRestriction" TEXT NOT NULL DEFAULT '',
  "cleaningConfirmedAt" TIMESTAMP(3), "inspectedAt" TIMESTAMP(3), "inspectedBy" TEXT, "inspectionHash" TEXT,
  "releasedAt" TIMESTAMP(3), "releasedBy" TEXT, "releaseHash" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("hotelId", "roomNumber")
);
CREATE TABLE "RoomReadinessEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "hotelId" TEXT NOT NULL, "roomNumber" TEXT NOT NULL,
  "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "note" TEXT NOT NULL, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RoomReadinessEvent_hotelId_roomNumber_at_idx" ON "RoomReadinessEvent"("hotelId", "roomNumber", "at");
CREATE TABLE "HousekeepingMaintenanceLink" (
  "id" TEXT NOT NULL PRIMARY KEY, "hotelId" TEXT NOT NULL, "reportTaskId" TEXT NOT NULL, "issueId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HousekeepingMaintenanceLink_hotelId_reportTaskId_issueId_key" ON "HousekeepingMaintenanceLink"("hotelId", "reportTaskId", "issueId");
CREATE INDEX "HousekeepingMaintenanceLink_hotelId_issueId_idx" ON "HousekeepingMaintenanceLink"("hotelId", "issueId");
