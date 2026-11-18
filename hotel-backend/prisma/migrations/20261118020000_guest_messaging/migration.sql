CREATE TABLE "GuestMessagingConfig" (
 "hotelId" TEXT PRIMARY KEY, "whatsappTemplate" TEXT NOT NULL DEFAULT '',
 "whatsappLanguage" TEXT NOT NULL DEFAULT 'en', "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "GuestMessagingInvite" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
 "customerId" TEXT NOT NULL, "channel" TEXT NOT NULL, "contact" TEXT NOT NULL,
 "codeHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'sending', "issuedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 "providerMessageId" TEXT, "conversationId" TEXT, "sourceMessageId" TEXT,
 "redeemedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "revokedBy" TEXT
);
CREATE UNIQUE INDEX "GuestMessagingInvite_codeHash_key" ON "GuestMessagingInvite"("codeHash");
CREATE INDEX "GuestMessagingInvite_hotelId_createdAt_idx" ON "GuestMessagingInvite"("hotelId", "createdAt");
CREATE INDEX "GuestMessagingInvite_hotelId_reservationId_contact_idx" ON "GuestMessagingInvite"("hotelId", "reservationId", "contact");
ALTER TABLE "PmsConversationBinding" ADD COLUMN "checkinInviteId" TEXT;
