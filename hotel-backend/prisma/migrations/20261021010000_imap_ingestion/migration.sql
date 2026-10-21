BEGIN;
ALTER TABLE "EmailIntegration" ADD COLUMN "imapUser" TEXT, ADD COLUMN "smtpUser" TEXT,
ADD COLUMN "imapPassword" TEXT, ADD COLUMN "smtpPassword" TEXT,
ADD COLUMN "imapSecurity" TEXT, ADD COLUMN "smtpSecurity" TEXT,
ADD COLUMN "imapMailboxKey" TEXT, ADD COLUMN "imapUidValidity" TEXT,
ADD COLUMN "imapLastUid" TEXT, ADD COLUMN "imapRecoveryUntilUid" TEXT,
ADD COLUMN "mailVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "EmailIntegration_imap_mailbox_key" ON "EmailIntegration"(lower("email")) WHERE "provider" IN ('credentials','hostinger');
CREATE TABLE "ImapInboundMessage" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "mailboxKey" TEXT NOT NULL,
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
    CONSTRAINT "ImapInboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImapInboundMessage_hotelId_status_idx" ON "ImapInboundMessage"("hotelId", "status");
CREATE UNIQUE INDEX "ImapInboundMessage_hotelId_mailbox_providerMessageId_key" ON "ImapInboundMessage"("hotelId", "mailbox", "providerMessageId");
COMMIT;
