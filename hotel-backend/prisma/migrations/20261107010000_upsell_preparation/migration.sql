ALTER TABLE "Reservation" ADD COLUMN "assignedRoom" TEXT;
ALTER TABLE "Task" ADD COLUMN "upsellOfferId" TEXT;
CREATE UNIQUE INDEX "Task_upsellOfferId_key" ON "Task"("upsellOfferId");
ALTER TABLE "PmsUpsellProduct" ADD COLUMN "preparationDepartment" TEXT;
ALTER TABLE "PmsUpsellProduct" ADD COLUMN "preparationInstructions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PmsUpsellProduct" ADD CONSTRAINT "upsell_preparation_department"
  CHECK ("preparationDepartment" IS NULL OR "preparationDepartment" IN ('Housekeeping', 'Front Office'));
-- Existing room amenities start with Housekeeping; managers can change each product.
-- Historical postings are deliberately not replayed into operational tasks.
UPDATE "PmsUpsellProduct" SET "preparationDepartment" = 'Housekeeping'
WHERE "category" IN ('romance', 'birthday', 'wine');

-- The PMS MCP writes posting results directly. Create the task in that same
-- transaction, including when the caller loses the response and retries.
CREATE FUNCTION create_upsell_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product RECORD; reservation RECORD; task_id TEXT; inserted_id TEXT;
BEGIN
  IF NEW."status" <> 'posted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'posted' THEN RETURN NEW; END IF;
  EXECUTE format('SELECT * FROM %I."PmsUpsellProduct" WHERE "hotelId" = $1 AND "productId" = $2', TG_TABLE_SCHEMA)
    INTO product USING NEW."hotelId", NEW."productId";
  IF product."preparationDepartment" IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT r."assignedRoom", r."status", g."name" FROM %I."Reservation" r JOIN %I."Guest" g ON g.id = r."guestId" AND g."hotelId" = r."hotelId" WHERE r."hotelId" = $1 AND r."mewsId" = $2 ORDER BY r."createdAt" DESC LIMIT 1', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
    INTO reservation USING NEW."hotelId", NEW."reservationId";
  task_id := 'upsell-prep-' || NEW.id;
  EXECUTE format('INSERT INTO %I."Task" (id, "hotelId", title, detail, room, guest, department, priority, "createdAt", due, status, source, "upsellOfferId", version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,''Normal'',$8,$9,$10,''Upsell preparation'',$11,0)
    ON CONFLICT ("upsellOfferId") DO NOTHING RETURNING id', TG_TABLE_SCHEMA)
    INTO inserted_id USING task_id, NEW."hotelId", 'Prepare: ' || NEW.name,
      'Reservation ' || NEW."reservationId" || ' | Quantity: ' || NEW.quantity || E'\n' || product."preparationInstructions",
      reservation."assignedRoom", reservation.name, product."preparationDepartment",
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(NEW."consumptionUtc", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      CASE WHEN reservation."assignedRoom" IS NULL THEN 'Waiting' ELSE 'New' END, NEW.id;
  IF inserted_id IS NOT NULL THEN
    EXECUTE format('INSERT INTO %I."TaskTrail" ("taskId", at, text, via) VALUES ($1,$2,$3,''pms'')', TG_TABLE_SCHEMA)
      USING task_id, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
      'Created after successful PMS posting. ' || CASE WHEN reservation."assignedRoom" IS NULL THEN 'Waiting for reservation room assignment.' ELSE 'Prepare the assigned room before the due time.' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upsell_preparation_posted AFTER INSERT OR UPDATE OF status ON "PmsUpsellOffer"
FOR EACH ROW EXECUTE FUNCTION create_upsell_preparation();

-- Reservation-specific room assignment: never infer it from Guest.room, which
-- can belong to a different stay. A move reopens completed preparation for review.
CREATE FUNCTION refresh_upsell_preparation_room() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed RECORD;
BEGIN
  FOR changed IN EXECUTE format('UPDATE %I."Task" t SET room = $1,
      status = CASE WHEN $1 IS NULL THEN ''Waiting'' ELSE ''New'' END,
      "completedAt" = NULL, version = t.version + 1
    FROM %I."PmsUpsellOffer" o WHERE t."upsellOfferId" = o.id AND t."hotelId" = $2
      AND o."hotelId" = $2 AND o."reservationId" = $3 AND t.room IS DISTINCT FROM $1
    RETURNING t.id', TG_TABLE_SCHEMA, TG_TABLE_SCHEMA)
    USING NEW."assignedRoom", NEW."hotelId", NEW."mewsId"
  LOOP
    EXECUTE format('INSERT INTO %I."TaskTrail" ("taskId", at, text, via) VALUES ($1,$2,$3,''pms'')', TG_TABLE_SCHEMA)
      USING changed.id, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
        'Reservation room changed to ' || coalesce(NEW."assignedRoom", 'unassigned') || '. Preparation must be checked again.';
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER upsell_preparation_room AFTER INSERT OR UPDATE OF "assignedRoom" ON "Reservation"
FOR EACH ROW EXECUTE FUNCTION refresh_upsell_preparation_room();

-- Enforce this for dashboard and worker/WhatsApp completion paths alike.
CREATE FUNCTION guard_upsell_preparation_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."upsellOfferId" IS NOT NULL AND NEW.status = 'Completed' AND NEW.room IS NULL THEN
    RAISE EXCEPTION 'Assign a reservation room before completing upsell preparation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upsell_preparation_completion BEFORE INSERT OR UPDATE ON "Task"
FOR EACH ROW EXECUTE FUNCTION guard_upsell_preparation_completion();
