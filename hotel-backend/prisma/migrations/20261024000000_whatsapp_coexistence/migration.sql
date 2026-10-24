ALTER TABLE "WhatsAppIntegration"
ADD COLUMN "onboardingMode" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "historySyncStatus" TEXT,
ADD COLUMN "contactSyncStatus" TEXT,
ADD COLUMN "syncError" TEXT;
