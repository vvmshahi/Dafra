-- Preserve the complete validated A4 contract after save. Historical partial
-- settings continue through the established V1 compatibility canonicalizer
-- until their first successful save upgrades them to the closed contract.
CREATE OR REPLACE FUNCTION public.get_branch_invoice_settings(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $get$
DECLARE
  u RECORD;
  b RECORD;
  settings JSONB;
  can_edit BOOLEAN;
BEGIN
  SELECT tenant_id, branch_id, role::TEXT AS role, is_active
    INTO u
    FROM public.user_profiles
    WHERE id = auth.uid();

  SELECT *
    INTO b
    FROM public.branches
    WHERE id = p_branch_id
      AND is_active;

  IF NOT FOUND
    OR NOT COALESCE(u.is_active, FALSE)
    OR NOT (
      (u.role = 'owner' AND u.tenant_id = b.tenant_id)
      OR (u.role = 'branch' AND u.tenant_id = b.tenant_id AND u.branch_id = b.id)
    ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(b.presentation_settings) = 'object'
    AND b.presentation_settings ? 'schema_version'
    AND b.presentation_settings ? 'branding'
    AND b.presentation_settings ? 'contact'
    AND b.presentation_settings ? 'footer'
    AND b.presentation_settings ? 'thermal'
    AND b.presentation_settings ? 'a4'
    AND b.presentation_settings->'a4' ? 'accent_color' THEN
    settings := public.validate_invoice_presentation_settings(
      b.presentation_settings,
      b.tenant_id,
      b.id
    );
  ELSE
    settings := public.v1_canonicalize_invoice_presentation_settings(
      COALESCE(b.presentation_settings, '{}'::JSONB),
      b.id
    );
  END IF;

  can_edit := u.role IN ('owner', 'branch');

  RETURN jsonb_build_object(
    'branch_id', b.id,
    'presentation_settings', settings,
    'invoice_language', settings->>'language',
    'print_mode', b.print_mode,
    'can_edit', can_edit,
    'role', u.role
  );
END;
$get$;

REVOKE ALL ON FUNCTION public.get_branch_invoice_settings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_invoice_settings(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_branch_invoice_settings(UUID) IS
  'Returns complete validated invoice presentation settings after save while retaining the historical partial-settings read path.';
