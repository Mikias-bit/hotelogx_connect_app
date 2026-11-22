ALTER TABLE "GuestMessagingConfig"
 ADD COLUMN "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "welcomeSince" TIMESTAMP(3),
 ADD COLUMN "confirmationSender" TEXT NOT NULL DEFAULT 'pms',
 ADD COLUMN "checkinSender" TEXT NOT NULL DEFAULT 'hotelogx',
 ADD COLUMN "arrivalInstructions" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "onlineCheckinUrl" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "catalogueUrl" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "welcomeUpsells" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "bookingWelcomeTemplate" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "checkinWelcomeTemplate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PmsConversationBinding" ADD COLUMN "contactVerificationId" TEXT;
CREATE TABLE "GuestContactVerification" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "reservationId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
 "channel" TEXT NOT NULL, "contact" TEXT NOT NULL, "conversationId" TEXT, "inviteId" TEXT,
 "method" TEXT NOT NULL, "verifiedBy" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "GuestContactVerification_contact_key" ON "GuestContactVerification"("hotelId", "reservationId", "channel", "contact");
CREATE INDEX "GuestContactVerification_hotelId_channel_contact_expiresAt_idx" ON "GuestContactVerification"("hotelId", "channel", "contact", "expiresAt");
CREATE TABLE "GuestWelcome" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "reservationId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
 "stage" TEXT NOT NULL, "channel" TEXT NOT NULL, "contact" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'sending', "source" TEXT NOT NULL DEFAULT 'automatic', "recordedBy" TEXT NOT NULL,
 "conversationId" TEXT, "messageId" TEXT, "providerMessageId" TEXT, "replyTokenHash" TEXT,
 "replyTokenUsedAt" TIMESTAMP(3), "verifyMessageId" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GuestWelcome_hotelId_reservationId_stage_key" ON "GuestWelcome"("hotelId", "reservationId", "stage");
CREATE UNIQUE INDEX "GuestWelcome_replyTokenHash_key" ON "GuestWelcome"("replyTokenHash");
CREATE INDEX "GuestWelcome_hotelId_channel_contact_idx" ON "GuestWelcome"("hotelId", "channel", "contact");
