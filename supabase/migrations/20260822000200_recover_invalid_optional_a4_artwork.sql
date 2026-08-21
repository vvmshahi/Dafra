-- Optional A4 artwork must never block a fiscal invoice when older settings
-- exceed a later layout bound. Valid settings follow the existing validator
-- byte-for-byte; only the known artwork-bound failure uses the canonical A4
-- default for the immutable issue-time snapshot. Stored branch settings and
-- issued documents are deliberately not rewritten here.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_invoice_presentation_settings_for_issue(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  branch_row record;
  settings jsonb;
  default_a4 jsonb;
BEGIN
  SELECT id, tenant_id, presentation_settings
    INTO branch_row
    FROM public.branches
    WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
  END IF;

  settings := coalesce(
    branch_row.presentation_settings,
    public.default_invoice_presentation_settings(p_branch_id)
  );
  BEGIN
    RETURN public.validate_invoice_presentation_settings(
      settings,
      branch_row.tenant_id,
      branch_row.id
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'A4 artwork dimensions are outside the safe range' THEN
      RAISE;
    END IF;
  END;

  default_a4 := public.default_invoice_presentation_settings(p_branch_id)->'a4';
  IF jsonb_typeof(default_a4) <> 'object' THEN
    RAISE EXCEPTION 'Canonical A4 presentation default is unavailable' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.validate_invoice_presentation_settings(
    jsonb_set(settings, '{a4}', default_a4, true),
    branch_row.tenant_id,
    branch_row.id
  );
END
$function$;

DO $migration$
DECLARE
  definition text;
  old_call constant text :=
    'public.resolve_invoice_presentation_settings(NEW.branch_id)';
  new_call constant text :=
    'public.resolve_invoice_presentation_settings_for_issue(NEW.branch_id)';
BEGIN
  definition := pg_get_functiondef('public.capture_invoice_identity_snapshot()'::regprocedure);
  IF position(new_call IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_call IN definition) = 0 THEN
    RAISE EXCEPTION 'Invoice identity snapshot does not contain the reviewed presentation resolver';
  END IF;
  EXECUTE replace(definition, old_call, new_call);
END
$migration$;

REVOKE ALL ON FUNCTION public.resolve_invoice_presentation_settings_for_issue(uuid)
  FROM public, anon, authenticated;

COMMENT ON FUNCTION public.resolve_invoice_presentation_settings_for_issue(uuid) IS
  'Resolves canonical issue-time presentation settings. Only invalid optional A4 artwork geometry is replaced with the existing canonical A4 default; valid settings are unchanged.';

COMMIT;
