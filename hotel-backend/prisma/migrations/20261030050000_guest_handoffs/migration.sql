CREATE TABLE "GuestHandoff" (
  "id" TEXT NOT NULL PRIMARY KEY, "hotelId" TEXT NOT NULL, "workKind" TEXT NOT NULL, "workId" TEXT NOT NULL, "conversationId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'open', "cycle" INTEGER NOT NULL DEFAULT 0,
  "workCompletedAt" TIMESTAMP(3), "workCompletedBy" TEXT, "foInformedAt" TIMESTAMP(3), "foInformedBy" TEXT,
  "contactStatus" TEXT NOT NULL DEFAULT 'pending', "contactedAt" TIMESTAMP(3), "contactedBy" TEXT, "contactChannel" TEXT, "contactNote" TEXT,
  "resolvedAt" TIMESTAMP(3), "resolvedBy" TEXT, "resolutionNote" TEXT, "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GuestHandoff_hotelId_workKind_workId_key" ON "GuestHandoff"("hotelId", "workKind", "workId");
CREATE INDEX "GuestHandoff_hotelId_state_idx" ON "GuestHandoff"("hotelId", "state");
CREATE INDEX "GuestHandoff_hotelId_conversationId_idx" ON "GuestHandoff"("hotelId", "conversationId");
CREATE TABLE "GuestHandoffEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "hotelId" TEXT NOT NULL, "handoffId" TEXT NOT NULL, "cycle" INTEGER NOT NULL,
  "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "note" TEXT NOT NULL, "data" JSONB NOT NULL DEFAULT '{}', "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GuestHandoffEvent_hotelId_handoffId_at_idx" ON "GuestHandoffEvent"("hotelId", "handoffId", "at");
-- Existing conversation-linked department work is guest work. Never infer guest
-- confirmation or Front Office acknowledgment from a department's Completed status.
INSERT INTO "GuestHandoff" ("id", "hotelId", "workKind", "workId", "conversationId", "workCompletedAt", "workCompletedBy")
SELECT 'gh-' || md5(t."hotelId" || ':task:' || t."id"), t."hotelId", 'task', t."id", c."id", t."completedAt", CASE WHEN t."completedAt" IS NOT NULL THEN 'legacy-record' ELSE NULL END
FROM "Task" t JOIN "Conversation" c ON c."id" = t."conversationId" JOIN "Guest" g ON g."id" = c."guestId" AND g."hotelId" = t."hotelId"
WHERE t."department" IN ('Housekeeping', 'Maintenance') AND t."status" NOT IN ('Cancelled', 'Duplicate');
UPDATE "GuestHandoff" h SET "state" = 'handoff' FROM "Task" t WHERE h."workKind" = 'task' AND h."workId" = t."id" AND t."status" = 'Completed';
UPDATE "Conversation" c SET "aiStatus" = 'escalated', "escalation" = COALESCE(c."escalation", '{"kind":"guest_follow_up","reason":"Department work completed; guest outcome requires Front Office review","urgency":"High"}')
WHERE EXISTS (SELECT 1 FROM "GuestHandoff" h WHERE h."conversationId" = c."id" AND h."state" = 'handoff');
