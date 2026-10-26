CREATE TABLE "PmsConversationBinding" (
 "conversationId" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
 "customerId" TEXT NOT NULL, "verifiedBy" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PmsConversationBinding_hotelId_idx" ON "PmsConversationBinding"("hotelId");
CREATE TABLE "PmsUpsellProduct" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "productId" TEXT NOT NULL, "serviceId" TEXT NOT NULL,
 "label" TEXT NOT NULL, "category" TEXT NOT NULL DEFAULT 'other', "priceSource" TEXT NOT NULL DEFAULT 'pms',
 "unitAmount" DECIMAL(12,2), "currency" TEXT, "knowledgeDocId" TEXT,
 "autoPost" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
 "updatedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PmsUpsellProduct_hotelId_productId_key" ON "PmsUpsellProduct"("hotelId","productId");
CREATE TABLE "PmsUpsellOffer" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "bindingVerifiedAt" TIMESTAMP(3) NOT NULL,
 "reservationId" TEXT NOT NULL, "customerId" TEXT NOT NULL, "productId" TEXT NOT NULL, "serviceId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "category" TEXT NOT NULL, "priceSource" TEXT NOT NULL, "priceHash" TEXT NOT NULL,
 "quantity" INTEGER NOT NULL, "unitAmount" DECIMAL(12,2) NOT NULL, "totalAmount" DECIMAL(12,2) NOT NULL,
 "currency" TEXT NOT NULL, "taxCodes" JSONB NOT NULL, "consumptionUtc" TIMESTAMP(3) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'offered', "requestKey" TEXT NOT NULL, "acceptedMessageId" TEXT,
 "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "approvalNote" TEXT, "result" JSONB, "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PmsUpsellOffer_requestKey_key" ON "PmsUpsellOffer"("requestKey");
CREATE INDEX "PmsUpsellOffer_hotelId_status_idx" ON "PmsUpsellOffer"("hotelId","status");
CREATE INDEX "PmsUpsellOffer_conversationId_createdAt_idx" ON "PmsUpsellOffer"("conversationId","createdAt");
