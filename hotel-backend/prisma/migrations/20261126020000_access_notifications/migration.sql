ALTER TABLE "HotelAccessRequest" ADD COLUMN "notificationStatus" TEXT NOT NULL DEFAULT 'pending', ADD COLUMN "notificationAttemptAt" TIMESTAMP(3);
ALTER TABLE "HotelOnboardingInvite" ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'pending', ADD COLUMN "deliveryAttemptAt" TIMESTAMP(3), ADD COLUMN "deliveryMessageId" TEXT;
-- Earlier approvals may already have been invited manually. Never resend them automatically.
UPDATE "HotelOnboardingInvite" SET "deliveryStatus" = 'manual-review';
