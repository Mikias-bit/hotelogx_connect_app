ALTER TABLE "WhatsAppIntegration"
 ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
 ADD COLUMN "lastInboundAt" TIMESTAMP(3), ADD COLUMN "lastOutboundAt" TIMESTAMP(3), ADD COLUMN "lastDeliveryStatus" TEXT;
-- Previously saved connections must pass Meta verification before becoming active.
UPDATE "WhatsAppIntegration" SET "status" = 'unverified', "lastError" = 'Reconnect to verify Meta authorization';
UPDATE "WhatsAppIntegration" SET "phoneNumberId" = NULL WHERE "phoneNumberId" !~ '^[0-9]+$';
-- Duplicate real IDs require review rather than assigning a number to an arbitrary hotel.
DROP INDEX IF EXISTS "WhatsAppIntegration_phoneNumberId_idx";
CREATE UNIQUE INDEX "WhatsAppIntegration_phoneNumberId_key" ON "WhatsAppIntegration"("phoneNumberId");
CREATE TABLE "WhatsAppReceipt" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "phoneNumberId" TEXT NOT NULL, "sender" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "replyText" TEXT, "replyMessageId" TEXT, "providerMessageId" TEXT, "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WhatsAppReceipt_hotelId_status_idx" ON "WhatsAppReceipt"("hotelId", "status");
