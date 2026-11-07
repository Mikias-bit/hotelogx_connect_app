ALTER TABLE "PmsUpsellOffer" ADD COLUMN "acceptedAt" TIMESTAMP(3), ADD COLUMN "postedAt" TIMESTAMP(3);

-- Acceptance has an auditable guest message. Do not use quote creation time.
UPDATE "PmsUpsellOffer" o SET "acceptedAt" = m."createdAt"
FROM "Message" m, "Conversation" c, "Guest" g
WHERE m."id" = o."acceptedMessageId" AND m."conversationId" = o."conversationId"
  AND c."id" = m."conversationId" AND g."id" = c."guestId" AND g."hotelId" = o."hotelId"
  AND m."author" = 'guest' AND upper(trim(m."body")) = 'ACCEPT ' || upper(o."id")
  AND m."createdAt" >= o."createdAt";

-- The separate PMS service writes rows directly. Capture its successful status
-- transition here, including when the HTTP response is lost. Older posted rows
-- remain undated: updatedAt is not an auditable posting date.
CREATE FUNCTION capture_upsell_reporting_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW."postedAt" := OLD."postedAt";
    NEW."acceptedAt" := OLD."acceptedAt";
    IF NEW."status" = 'posted' AND OLD."status" IS DISTINCT FROM 'posted' AND NEW."postedAt" IS NULL THEN
      NEW."postedAt" := clock_timestamp() AT TIME ZONE 'UTC';
    END IF;
  ELSIF NEW."status" = 'posted' THEN
    NEW."postedAt" := clock_timestamp() AT TIME ZONE 'UTC';
  END IF;
  IF NEW."acceptedAt" IS NULL AND NEW."acceptedMessageId" IS NOT NULL THEN
    -- Prisma and external clients can have different search paths. Always read
    -- from the same schema as the offer row, never the caller's search path.
    EXECUTE format('SELECT m."createdAt" FROM %I."Message" m
      JOIN %I."Conversation" c ON c."id" = m."conversationId"
      JOIN %I."Guest" g ON g."id" = c."guestId"
      WHERE m."id" = $1 AND m."conversationId" = $2 AND g."hotelId" = $3
        AND m."author" = ''guest'' AND upper(trim(m."body")) = ''ACCEPT '' || upper($4)
        AND m."createdAt" >= $5', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
      INTO NEW."acceptedAt"
      USING NEW."acceptedMessageId", NEW."conversationId", NEW."hotelId", NEW."id", NEW."createdAt";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER upsell_reporting_dates BEFORE INSERT OR UPDATE ON "PmsUpsellOffer"
FOR EACH ROW EXECUTE FUNCTION capture_upsell_reporting_dates();
