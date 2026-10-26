CREATE TABLE "DailyReportSource" (
 "hotelId" TEXT PRIMARY KEY, "engineHotelId" TEXT NOT NULL UNIQUE,
 "tokenHash" TEXT NOT NULL UNIQUE, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DailyReportSource_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "DailyReport" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "reportDate" TEXT NOT NULL, "runId" TEXT NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "status" TEXT NOT NULL,
 "checksum" TEXT NOT NULL, "rows" JSONB NOT NULL,
 CONSTRAINT "DailyReport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DailyReport_hotelId_kind_reportDate_runId_key" ON "DailyReport"("hotelId","kind","reportDate","runId");
CREATE INDEX "DailyReport_hotelId_kind_reportDate_generatedAt_idx" ON "DailyReport"("hotelId","kind","reportDate","generatedAt");
CREATE TABLE "DailyReportReview" (
 "id" TEXT PRIMARY KEY, "hotelId" TEXT NOT NULL, "kind" TEXT NOT NULL, "reportDate" TEXT NOT NULL,
 "itemKey" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "status" TEXT NOT NULL, "note" TEXT NOT NULL DEFAULT '',
 "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DailyReportReview_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DailyReportReview_hotelId_kind_reportDate_itemKey_key" ON "DailyReportReview"("hotelId","kind","reportDate","itemKey");
