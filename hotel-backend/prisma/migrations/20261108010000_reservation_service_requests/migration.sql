CREATE TABLE "ReservationServiceRequest" (
  "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "conversationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "requestText" TEXT NOT NULL,
  "sourceMessageId" TEXT, "reservationId" TEXT, "taskId" TEXT, "note" TEXT NOT NULL DEFAULT '',
  "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ReservationServiceRequest_sourceMessageId_kind_key" ON "ReservationServiceRequest"("sourceMessageId", "kind");
CREATE INDEX "ReservationServiceRequest_hotelId_conversationId_status_idx" ON "ReservationServiceRequest"("hotelId", "conversationId", "status");
