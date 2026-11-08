-- Baby cots always need Housekeeping setup, including products previously
-- saved as 'other' with no preparation team. Do not replay historical sales.
CREATE FUNCTION route_baby_cot_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category = 'baby_cot' OR NEW.label ~* '\m(cots?|cribs?|baby[ -]?beds?|babybed(je)?s?)\M' THEN
    NEW.category := 'baby_cot';
    NEW."preparationDepartment" := 'Housekeeping';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER baby_cot_preparation BEFORE INSERT OR UPDATE ON "PmsUpsellProduct"
FOR EACH ROW EXECUTE FUNCTION route_baby_cot_preparation();

UPDATE "PmsUpsellProduct" SET "preparationDepartment" = 'Housekeeping', category = 'baby_cot'
WHERE category = 'baby_cot' OR label ~* '\m(cots?|cribs?|baby[ -]?beds?|babybed(je)?s?)\M';
