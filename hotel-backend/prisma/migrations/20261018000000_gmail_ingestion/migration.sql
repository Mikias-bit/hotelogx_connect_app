BEGIN;
ALTER TABLE "EmailIntegration" ADD COLUMN "watchError" TEXT,
ADD COLUMN "watchExpiresAt" TIMESTAMP(3);

-- Reject ambiguous routing rather than silently attaching one mailbox to two hotels.
-- Existing duplicates must be explicitly resolved before applying this migration.
CREATE UNIQUE INDEX "EmailIntegration_google_mailbox_key"
ON "EmailIntegration" (lower("email")) WHERE "provider" = 'google';

CREATE TABLE "GmailMailboxLock" (
    "hotelId" TEXT NOT NULL,
    "token" TEXT,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "GmailMailboxLock_pkey" PRIMARY KEY ("hotelId")
);

CREATE TABLE "GmailInboundMessage" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "threadId" TEXT,
    "sender" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "internetMessageId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "suppressReply" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "automationResult" JSONB,
    "replyStatus" TEXT NOT NULL DEFAULT 'pending',
    "outboundMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GmailInboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GmailInboundMessage_hotelId_status_idx" ON "GmailInboundMessage"("hotelId", "status");
CREATE UNIQUE INDEX "GmailInboundMessage_hotelId_mailbox_providerMessageId_key" ON "GmailInboundMessage"("hotelId", "mailbox", "providerMessageId");
COMMIT;
