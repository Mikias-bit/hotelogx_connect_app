CREATE TABLE "ShiftHandover" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "shiftDate" TEXT NOT NULL,
 "shift" TEXT NOT NULL, "targetDate" TEXT NOT NULL, "targetShift" TEXT NOT NULL,
 "title" TEXT NOT NULL, "body" TEXT NOT NULL, "room" TEXT,
 "priority" TEXT NOT NULL DEFAULT 'Normal', "status" TEXT NOT NULL DEFAULT 'Open',
 "authorId" TEXT NOT NULL, "authorName" TEXT NOT NULL,
 "events" JSONB NOT NULL DEFAULT '[]', "version" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ShiftHandover_hotelId_shiftDate_idx" ON "ShiftHandover"("hotelId", "shiftDate");
CREATE INDEX "ShiftHandover_hotelId_status_targetDate_idx" ON "ShiftHandover"("hotelId", "status", "targetDate");
