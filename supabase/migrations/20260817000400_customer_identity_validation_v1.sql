-- Enforce the customer-master completeness contract for direct authenticated writes.
-- Existing historical rows remain readable; validation applies only on insert/update.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_customer_identity_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.name := NULLIF(btrim(NEW.name), '');
  NEW.phone := NULLIF(btrim(NEW.phone), '');
  NEW.city := NULLIF(btrim(NEW.city), '');

  IF NEW.customer_type NOT IN ('individual', 'business') THEN
    RAISE EXCEPTION 'CUSTOMER_TYPE_REQUIRED' USING ERRCODE = '23514';
  END IF;

  IF NEW.name IS NULL OR NEW.phone IS NULL OR NEW.city IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_CORE_FIELDS_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW.phone !~ '^05[0-9]{8}$' THEN
    RAISE EXCEPTION 'CUSTOMER_PHONE_INVALID' USING ERRCODE = '23514';
  END IF;

  IF NEW.customer_type = 'business' THEN
    NEW.business_name := NULLIF(btrim(NEW.business_name), '');
    NEW.vat_number := NULLIF(btrim(NEW.vat_number), '');
    NEW.cr_number := NULLIF(btrim(NEW.cr_number), '');
    IF NEW.business_name IS NULL OR NEW.vat_number IS NULL OR NEW.cr_number IS NULL THEN
      RAISE EXCEPTION 'BUSINESS_CUSTOMER_CORE_FIELDS_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF NEW.vat_number !~ '^3[0-9]{13}3$' THEN
      RAISE EXCEPTION 'BUSINESS_CUSTOMER_VAT_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.cr_number !~ '^[A-Za-z0-9]+$' THEN
      RAISE EXCEPTION 'BUSINESS_CUSTOMER_CR_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_identity_validation_v1 ON public.customers;
CREATE TRIGGER trg_customer_identity_validation_v1
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.validate_customer_identity_v1();

REVOKE ALL ON FUNCTION public.validate_customer_identity_v1() FROM PUBLIC;

COMMIT;
