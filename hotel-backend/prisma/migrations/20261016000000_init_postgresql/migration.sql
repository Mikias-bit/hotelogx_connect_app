-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Hotel" (
    "id" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 4,
    "roomsCount" INTEGER NOT NULL DEFAULT 48,
    "address" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Brussels',
    "currency" TEXT NOT NULL DEFAULT '€',
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "bookingEngine" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "checkIn" TEXT NOT NULL DEFAULT '15:00',
    "checkOut" TEXT NOT NULL DEFAULT '11:00',
    "vatNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "waTopology" TEXT NOT NULL DEFAULT 'separate',
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "onboardingSteps" TEXT NOT NULL DEFAULT '[]',
    "aiMode" TEXT NOT NULL DEFAULT 'Autonomous',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT DEFAULT 'hotel-mercier',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Staff',
    "phone" TEXT NOT NULL DEFAULT '',
    "initials" TEXT NOT NULL DEFAULT '',
    "lastActive" TEXT NOT NULL DEFAULT 'now',
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "number" TEXT NOT NULL,
    "mewsId" TEXT,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "floor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Clean',
    "cleaningType" TEXT NOT NULL DEFAULT 'Departure',
    "guestStatus" TEXT NOT NULL DEFAULT 'Vacant',
    "arrivalTime" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "cleaner" TEXT,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("hotelId","number")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "mewsId" TEXT,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "name" TEXT NOT NULL,
    "room" TEXT,
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "previousStays" INTEGER NOT NULL DEFAULT 0,
    "tags" VARCHAR(2048) NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "number" TEXT NOT NULL,
    "mewsId" TEXT,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "guestId" TEXT NOT NULL,
    "arrival" TEXT NOT NULL,
    "departure" TEXT NOT NULL,
    "nights" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL DEFAULT 0,
    "roomType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Confirmed',
    "rate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("hotelId","number")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "primaryChannel" TEXT NOT NULL,
    "aiStatus" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "suggestedReply" TEXT NOT NULL,
    "knowledgeUsed" VARCHAR(2048) NOT NULL DEFAULT '[]',
    "upsellIdeas" VARCHAR(2048) NOT NULL DEFAULT '[]',
    "taskIds" VARCHAR(2048) NOT NULL DEFAULT '[]',
    "escalation" TEXT,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TEXT NOT NULL,
    "aiHandledCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "staffName" TEXT,
    "knowledge" TEXT NOT NULL DEFAULT '[]',
    "buttons" TEXT NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION,
    "deliveryStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "room" TEXT,
    "guest" TEXT,
    "department" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "createdAt" TEXT NOT NULL,
    "due" TEXT,
    "assignee" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "source" TEXT NOT NULL DEFAULT 'AI Detection',
    "conversationId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTrail" (
    "id" SERIAL NOT NULL,
    "taskId" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "via" TEXT,

    CONSTRAINT "TaskTrail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "room" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "reportedBy" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'Dashboard',
    "createdAt" TEXT NOT NULL,
    "assignee" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Reported',
    "outOfService" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueUpdate" (
    "id" SERIAL NOT NULL,
    "issueId" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "via" TEXT,

    CONSTRAINT "IssueUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upsell" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "guest" TEXT NOT NULL,
    "room" TEXT,
    "offer" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "date" TEXT NOT NULL,

    CONSTRAINT "Upsell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "size" TEXT NOT NULL DEFAULT '0 KB',
    "updated" TEXT NOT NULL DEFAULT 'Just now',
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "aiReady" BOOLEAN NOT NULL DEFAULT true,
    "usedToday" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "storagePath" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRule" (
    "id" SERIAL NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "topic" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "at" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "meta" TEXT,

    CONSTRAINT "ActivityItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaThread" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "contact" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL DEFAULT 'hotel-mercier',
    "from" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "buttons" TEXT NOT NULL DEFAULT '[]',
    "chosen" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmsIntegration" (
    "hotelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mews',
    "propertyId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmsIntegration_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "EmailIntegration" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'credentials',
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "scope" TEXT,
    "historyId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppIntegration" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "phoneNumberId" TEXT,
    "wabaId" TEXT,
    "accessToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'warm',
    "autonomyLevel" TEXT NOT NULL DEFAULT 'Autonomous',
    "autoReply" BOOLEAN NOT NULL DEFAULT true,
    "rulesJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingState" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "pmsDone" BOOLEAN NOT NULL DEFAULT false,
    "emailDone" BOOLEAN NOT NULL DEFAULT false,
    "guestWaDone" BOOLEAN NOT NULL DEFAULT false,
    "internalWaDone" BOOLEAN NOT NULL DEFAULT false,
    "kbDone" BOOLEAN NOT NULL DEFAULT false,
    "usersDone" BOOLEAN NOT NULL DEFAULT false,
    "aiDone" BOOLEAN NOT NULL DEFAULT false,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "rooms" INTEGER NOT NULL DEFAULT 48,
    "pricePerRoom" DOUBLE PRECISION NOT NULL DEFAULT 7.0,
    "seatsUsed" INTEGER NOT NULL DEFAULT 4,
    "startedOn" TEXT NOT NULL DEFAULT '14 Aug 2025',
    "renewsOn" TEXT NOT NULL DEFAULT '14 Aug 2026',
    "paymentBrand" TEXT DEFAULT 'Visa',
    "paymentLast4" TEXT DEFAULT '4417',
    "paymentExpiry" TEXT DEFAULT '09/28',
    "paymentHolder" TEXT DEFAULT 'Hotel Mercier BV',
    "provider" TEXT DEFAULT 'none',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'Paid',
    "pdfUrl" TEXT,
    "providerInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumedOAuthToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumedOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_hotelId_idx" ON "User"("hotelId");

-- CreateIndex
CREATE INDEX "Room_hotelId_status_idx" ON "Room"("hotelId", "status");

-- CreateIndex
CREATE INDEX "Room_hotelId_mewsId_idx" ON "Room"("hotelId", "mewsId");

-- CreateIndex
CREATE INDEX "Room_hotelId_idx" ON "Room"("hotelId");

-- CreateIndex
CREATE INDEX "Guest_hotelId_name_idx" ON "Guest"("hotelId", "name");

-- CreateIndex
CREATE INDEX "Guest_hotelId_mewsId_idx" ON "Guest"("hotelId", "mewsId");

-- CreateIndex
CREATE INDEX "Guest_hotelId_idx" ON "Guest"("hotelId");

-- CreateIndex
CREATE INDEX "Reservation_guestId_idx" ON "Reservation"("guestId");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_status_idx" ON "Reservation"("hotelId", "status");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_arrival_idx" ON "Reservation"("hotelId", "arrival");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_mewsId_idx" ON "Reservation"("hotelId", "mewsId");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_idx" ON "Reservation"("hotelId");

-- CreateIndex
CREATE INDEX "Conversation_guestId_idx" ON "Conversation"("guestId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Task_hotelId_status_idx" ON "Task"("hotelId", "status");

-- CreateIndex
CREATE INDEX "Task_hotelId_createdAt_idx" ON "Task"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_hotelId_idx" ON "Task"("hotelId");

-- CreateIndex
CREATE INDEX "TaskTrail_taskId_idx" ON "TaskTrail"("taskId");

-- CreateIndex
CREATE INDEX "Issue_hotelId_status_idx" ON "Issue"("hotelId", "status");

-- CreateIndex
CREATE INDEX "Issue_hotelId_createdAt_idx" ON "Issue"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "Issue_hotelId_idx" ON "Issue"("hotelId");

-- CreateIndex
CREATE INDEX "IssueUpdate_issueId_idx" ON "IssueUpdate"("issueId");

-- CreateIndex
CREATE INDEX "Upsell_hotelId_status_idx" ON "Upsell"("hotelId", "status");

-- CreateIndex
CREATE INDEX "Upsell_hotelId_date_idx" ON "Upsell"("hotelId", "date");

-- CreateIndex
CREATE INDEX "Upsell_hotelId_idx" ON "Upsell"("hotelId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_hotelId_category_idx" ON "KnowledgeDoc"("hotelId", "category");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_hotelId_idx" ON "KnowledgeDoc"("hotelId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_docId_idx" ON "KnowledgeChunk"("docId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_hotelId_idx" ON "KnowledgeChunk"("hotelId");

-- CreateIndex
CREATE INDEX "AiRule_hotelId_idx" ON "AiRule"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "AiRule_hotelId_topic_key" ON "AiRule"("hotelId", "topic");

-- CreateIndex
CREATE INDEX "ActivityItem_hotelId_at_idx" ON "ActivityItem"("hotelId", "at");

-- CreateIndex
CREATE INDEX "ActivityItem_hotelId_idx" ON "ActivityItem"("hotelId");

-- CreateIndex
CREATE INDEX "WaThread_hotelId_idx" ON "WaThread"("hotelId");

-- CreateIndex
CREATE INDEX "WaMessage_threadId_idx" ON "WaMessage"("threadId");

-- CreateIndex
CREATE INDEX "WaMessage_hotelId_idx" ON "WaMessage"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIntegration_hotelId_key" ON "EmailIntegration"("hotelId");

-- CreateIndex
CREATE INDEX "WhatsAppIntegration_phoneNumberId_idx" ON "WhatsAppIntegration"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppIntegration_hotelId_idx" ON "WhatsAppIntegration"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppIntegration_hotelId_targetType_key" ON "WhatsAppIntegration"("hotelId", "targetType");

-- CreateIndex
CREATE UNIQUE INDEX "AiConfig_hotelId_key" ON "AiConfig"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingState_hotelId_key" ON "OnboardingState"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_hotelId_key" ON "Subscription"("hotelId");

-- CreateIndex
CREATE INDEX "Subscription_hotelId_idx" ON "Subscription"("hotelId");

-- CreateIndex
CREATE INDEX "Invoice_hotelId_idx" ON "Invoice"("hotelId");

-- CreateIndex
CREATE INDEX "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedOAuthToken_tokenHash_key" ON "ConsumedOAuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ConsumedOAuthToken_expiresAt_idx" ON "ConsumedOAuthToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ConsumedOAuthToken_hotelId_idx" ON "ConsumedOAuthToken"("hotelId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTrail" ADD CONSTRAINT "TaskTrail_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueUpdate" ADD CONSTRAINT "IssueUpdate_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WaThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmsIntegration" ADD CONSTRAINT "PmsIntegration_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
