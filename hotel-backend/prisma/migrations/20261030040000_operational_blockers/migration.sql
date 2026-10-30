ALTER TABLE "ReportTask" ADD COLUMN "carryForward" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "carryReviewedDate" TEXT;
UPDATE "ReportTask" SET "carryForward" = true
WHERE "kind" = 'housekeeping' AND "active" = true AND "status" NOT IN ('Completed', 'Cancelled')
AND ("origin" = 'staff' OR "status" IN ('Problem', 'Waiting', 'Escalated'));
CREATE TABLE "OperationalBlocker" (
  "id" TEXT NOT NULL PRIMARY KEY, "hotelId" TEXT NOT NULL, "workKind" TEXT NOT NULL, "workId" TEXT NOT NULL,
  "type" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "details" JSONB NOT NULL DEFAULT '{}',
  "ownerName" TEXT NOT NULL DEFAULT '', "department" TEXT NOT NULL, "nextAction" TEXT NOT NULL DEFAULT '',
  "followUpAt" TIMESTAMP(3), "followUpLocal" TEXT, "timezone" TEXT NOT NULL,
  "needsDetails" BOOLEAN NOT NULL DEFAULT true, "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3), "resolvedBy" TEXT, "resolutionNote" TEXT
);
CREATE UNIQUE INDEX "OperationalBlocker_hotelId_requestKey_key" ON "OperationalBlocker"("hotelId", "requestKey");
CREATE UNIQUE INDEX "OperationalBlocker_one_open_type" ON "OperationalBlocker"("hotelId", "workKind", "workId", "type") WHERE "resolvedAt" IS NULL;
CREATE INDEX "OperationalBlocker_hotelId_resolvedAt_followUpAt_idx" ON "OperationalBlocker"("hotelId", "resolvedAt", "followUpAt");
CREATE INDEX "OperationalBlocker_hotelId_workKind_workId_idx" ON "OperationalBlocker"("hotelId", "workKind", "workId");
CREATE TABLE "OperationalBlockerEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "hotelId" TEXT NOT NULL, "blockerId" TEXT NOT NULL, "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL, "data" JSONB NOT NULL, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OperationalBlockerEvent_hotelId_blockerId_at_idx" ON "OperationalBlockerEvent"("hotelId", "blockerId", "at");

-- Recover unresolved deferred work hidden by earlier daily projections.
UPDATE "ReportTask" SET "active" = true, "carryForward" = true
WHERE "kind" = 'housekeeping' AND "status" IN ('Problem', 'Waiting', 'Escalated');
INSERT INTO "OperationalBlocker" ("id", "hotelId", "workKind", "workId", "type", "description", "department", "timezone", "requestKey", "requestHash", "createdBy")
SELECT 'blocker-legacy-' || md5(r."hotelId" || ':report:' || r."id"), r."hotelId", 'report', r."id", 'dnd', COALESCE(r."problemNote", ''), 'Housekeeping', COALESCE(h."timezone", 'Europe/Amsterdam'),
  'legacy-' || md5(r."hotelId" || ':report:' || r."id"), md5(r."id"), 'migration'
FROM "ReportTask" r LEFT JOIN "Hotel" h ON h."id" = r."hotelId"
WHERE r."kind" = 'housekeeping' AND r."status" = 'Problem' AND r."problemType" = 'dnd';
INSERT INTO "OperationalBlocker" ("id", "hotelId", "workKind", "workId", "type", "description", "department", "timezone", "requestKey", "requestHash", "createdBy")
SELECT 'blocker-legacy-' || md5(i."hotelId" || ':issue:' || i."id"), i."hotelId", 'issue', i."id", 'parts', COALESCE(i."problemNote", ''), 'Maintenance', COALESCE(h."timezone", 'Europe/Amsterdam'),
  'legacy-' || md5(i."hotelId" || ':issue:' || i."id"), md5(i."id"), 'migration'
FROM "Issue" i LEFT JOIN "Hotel" h ON h."id" = i."hotelId" WHERE i."status" = 'Waiting Parts';
INSERT INTO "OperationalBlocker" ("id", "hotelId", "workKind", "workId", "type", "description", "department", "timezone", "requestKey", "requestHash", "createdBy")
SELECT 'blocker-legacy-' || md5(t."hotelId" || ':task:' || t."id"), t."hotelId", 'task', t."id", 'parts', COALESCE(t."problemNote", ''), 'Maintenance', COALESCE(h."timezone", 'Europe/Amsterdam'),
  'legacy-' || md5(t."hotelId" || ':task:' || t."id"), md5(t."id"), 'migration'
FROM "Task" t LEFT JOIN "Hotel" h ON h."id" = t."hotelId" WHERE t."department" = 'Maintenance' AND t."status" IN ('Waiting', 'Waiting Parts');
