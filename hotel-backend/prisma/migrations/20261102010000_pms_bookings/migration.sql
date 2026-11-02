CREATE TABLE "PmsBookingConfig" (
  "hotelId" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT false, "autoBook" BOOLEAN NOT NULL DEFAULT false,
  "serviceId" TEXT NOT NULL, "categoryIds" JSONB NOT NULL, "rateTerms" JSONB NOT NULL,
  "arrivalTime" TEXT NOT NULL DEFAULT '15:00', "departureTime" TEXT NOT NULL DEFAULT '11:00',
  "paymentInstructions" TEXT NOT NULL, "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PmsBookingOffer" (
  "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  "request" JSONB NOT NULL, "guestDetails" JSONB NOT NULL, "snapshot" JSONB NOT NULL,
  "configVersion" TEXT NOT NULL, "replyText" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'offered',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedMessageId" TEXT, "approvedBy" TEXT, "approvedAt" TIMESTAMP(3),
  "approvalNote" TEXT, "customerId" TEXT, "result" JSONB, "lastError" TEXT,
  "paymentStatus" TEXT NOT NULL DEFAULT 'staff_follow_up', "paymentFollowUpBy" TEXT, "paymentFollowUpAt" TIMESTAMP(3), "paymentFollowUpNote" TEXT
);
CREATE UNIQUE INDEX "PmsBookingOffer_requestKey_key" ON "PmsBookingOffer"("requestKey");
CREATE INDEX "PmsBookingOffer_hotelId_conversationId_createdAt_idx" ON "PmsBookingOffer"("hotelId", "conversationId", "createdAt");
