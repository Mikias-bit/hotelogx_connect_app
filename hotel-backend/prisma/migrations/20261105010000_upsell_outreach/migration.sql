ALTER TABLE "Guest" ADD COLUMN "email" TEXT, ADD COLUMN "phone" TEXT;
ALTER TABLE "PmsUpsellOffer" ADD COLUMN "deliveryMessageId" TEXT;
ALTER TABLE "PmsUpsellProduct" ADD COLUMN "preArrival" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "keywords" TEXT NOT NULL DEFAULT '';
CREATE TABLE "UpsellAutomationConfig" (
  "hotelId" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "daysBeforeArrival" INTEGER NOT NULL DEFAULT 3, "channel" TEXT NOT NULL DEFAULT 'email_first',
  "whatsappTemplate" TEXT NOT NULL DEFAULT '', "whatsappLanguage" TEXT NOT NULL DEFAULT 'en_US',
  "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "UpsellOutreach" (
  "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved', "name" TEXT NOT NULL,
  "unitAmount" DECIMAL(12,2), "currency" TEXT, "messageId" TEXT, "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "UpsellOutreach_hotelId_reservationId_productId_key" ON "UpsellOutreach"("hotelId", "reservationId", "productId");
CREATE INDEX "UpsellOutreach_hotelId_conversationId_idx" ON "UpsellOutreach"("hotelId", "conversationId");
