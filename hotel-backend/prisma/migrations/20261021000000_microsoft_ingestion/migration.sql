BEGIN;
ALTER TABLE "EmailIntegration" ADD COLUMN "lastDeltaLink" TEXT,
ADD COLUMN "graphSubscriptionId" TEXT, ADD COLUMN "graphClientState" TEXT,
ADD COLUMN "microsoftConnectedAt" TIMESTAMP(3), ADD COLUMN "microsoftRetryAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "EmailIntegration_graphSubscriptionId_key" ON "EmailIntegration"("graphSubscriptionId");
CREATE UNIQUE INDEX "EmailIntegration_microsoft_mailbox_key" ON "EmailIntegration"(lower("email")) WHERE "provider" = 'microsoft';
CREATE TABLE "MicrosoftSyncJob" (
  "hotelId" TEXT PRIMARY KEY, "revision" TEXT NOT NULL,
  "renew" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "MicrosoftInboundMessage" (
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
    CONSTRAINT "MicrosoftInboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MicrosoftInboundMessage_hotelId_status_idx" ON "MicrosoftInboundMessage"("hotelId", "status");
CREATE UNIQUE INDEX "MicrosoftInboundMessage_hotelId_mailbox_providerMessageId_key" ON "MicrosoftInboundMessage"("hotelId", "mailbox", "providerMessageId");
COMMIT;
