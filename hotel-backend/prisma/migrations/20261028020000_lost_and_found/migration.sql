CREATE TABLE "LostFoundItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "item" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "foundLocation" VARCHAR(200) NOT NULL,
    "storageLocation" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LostFoundItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LostFoundItem_hotelId_createdAt_id_idx" ON "LostFoundItem"("hotelId", "createdAt", "id");
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
