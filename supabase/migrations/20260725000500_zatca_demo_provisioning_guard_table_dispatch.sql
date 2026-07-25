BEGIN;

CREATE OR REPLACE FUNCTION public.zatca_demo_provisioning_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_is_demo boolean;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND (
         (TG_OP = 'INSERT' AND NEW.is_demo IS TRUE)
         OR (TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo)
       )
    THEN
      RAISE EXCEPTION 'Demo tenant marker is managed by secure provisioning'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'branches' THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND (
         (TG_OP = 'INSERT' AND NEW.zatca_environment <> 'production')
         OR (
           TG_OP = 'UPDATE'
           AND NEW.zatca_environment IS DISTINCT FROM OLD.zatca_environment
         )
       )
    THEN
      RAISE EXCEPTION 'Branch ZATCA environment is managed by secure provisioning'
        USING ERRCODE = '42501';
    END IF;

    SELECT t.is_demo
      INTO v_is_demo
    FROM public.tenants t
    WHERE t.id = NEW.tenant_id;

    IF (v_is_demo IS TRUE AND NEW.zatca_environment <> 'sandbox')
       OR (v_is_demo IS NOT TRUE AND NEW.zatca_environment <> 'production')
    THEN
      RAISE EXCEPTION 'Demo branches require sandbox and ordinary branches require production'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'ZATCA demo provisioning guard does not support table %', TG_TABLE_NAME
    USING ERRCODE = '0A000';
END;
$function$;

COMMIT;
