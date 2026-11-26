ALTER TABLE "User" ADD COLUMN "netlifyIdentityId" TEXT, ADD COLUMN "netlifyIdentityIssuer" TEXT;
CREATE UNIQUE INDEX "User_netlifyIdentityId_key" ON "User"("netlifyIdentityId");
CREATE TABLE "HotelOnboardingInvite" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "email" TEXT NOT NULL, "name" TEXT NOT NULL,
 "role" TEXT NOT NULL DEFAULT 'manager', "approvedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 "acceptedAt" TIMESTAMP(3), "identityId" TEXT, "revokedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "HotelOnboardingInvite_email_key" ON "HotelOnboardingInvite"("email");
CREATE UNIQUE INDEX "HotelOnboardingInvite_identityId_key" ON "HotelOnboardingInvite"("identityId");
CREATE INDEX "HotelOnboardingInvite_hotelId_idx" ON "HotelOnboardingInvite"("hotelId");
CREATE TABLE "HotelAccessRequest" (
 "id" TEXT PRIMARY KEY, "email" TEXT NOT NULL, "name" TEXT NOT NULL, "hotelName" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HotelAccessRequest_email_key" ON "HotelAccessRequest"("email");
