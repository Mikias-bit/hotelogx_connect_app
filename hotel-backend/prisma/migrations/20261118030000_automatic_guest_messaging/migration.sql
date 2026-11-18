ALTER TABLE "GuestMessagingConfig"
 ADD COLUMN "automaticEnabled" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "automaticChannel" TEXT NOT NULL DEFAULT 'email_first',
 ADD COLUMN "enabledSince" TIMESTAMP(3),
 ADD COLUMN "mewsEnterpriseId" TEXT,
 ADD COLUMN "mewsIntegrationId" TEXT,
 ADD COLUMN "stayServiceId" TEXT,
 ADD COLUMN "lastScannedAt" TIMESTAMP(3),
 ADD COLUMN "scanEnd" TIMESTAMP(3),
 ADD COLUMN "scanCursor" TEXT,
 ADD COLUMN "workerToken" TEXT,
 ADD COLUMN "workerUntil" TIMESTAMP(3),
 ADD COLUMN "automationError" TEXT;
ALTER TABLE "GuestMessagingInvite" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'staff';
CREATE TABLE "GuestMessagingJob" (
 "hotelId" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "revision" INTEGER NOT NULL DEFAULT 1,
 "attempts" INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3), "leaseToken" TEXT, "reason" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("hotelId", "reservationId")
);
CREATE INDEX "GuestMessagingJob_hotelId_status_availableAt_idx" ON "GuestMessagingJob"("hotelId", "status", "availableAt");
