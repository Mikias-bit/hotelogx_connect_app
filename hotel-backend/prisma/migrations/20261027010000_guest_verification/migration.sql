ALTER TABLE "PmsConversationBinding" ADD COLUMN "expiresAt" TIMESTAMP(3), ADD COLUMN "verificationMethod" TEXT NOT NULL DEFAULT 'staff';
CREATE TABLE "PmsGuestVerification" (
 "conversationId" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'collecting', "step" INTEGER NOT NULL DEFAULT 0,
 "version" INTEGER NOT NULL DEFAULT 0, "encryptedData" TEXT NOT NULL,
 "codeHash" TEXT, "codeExpiresAt" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0,
 "emailHash" TEXT, "sendCount" INTEGER NOT NULL DEFAULT 0, "lastMessageId" TEXT, "lastReply" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PmsGuestVerification_hotelId_emailHash_updatedAt_idx" ON "PmsGuestVerification"("hotelId","emailHash","updatedAt");
