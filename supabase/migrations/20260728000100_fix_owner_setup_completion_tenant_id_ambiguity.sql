-- Fix mark_owner_setup_complete() failing with SQLSTATE 42702 because its
-- RETURNS TABLE tenant_id output variable collides with the column conflict target.
-- The named unique constraint is unambiguous and preserves the existing upsert.

CREATE OR REPLACE FUNCTION public.mark_owner_setup_complete()
RETURNS TABLE (
  tenant_id UUID,
  onboarding_status TEXT,
  owner_setup_status TEXT,
  owner_setup_completed_at TIMESTAMPTZ,
  already_completed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_existing_completed_at TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT
    up.tenant_id,
    up.role::text AS role,
    COALESCE(up.is_active, TRUE) AS is_active
  INTO v_profile
  FROM public.user_profiles up
  WHERE up.id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE OR v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role <> 'owner' THEN
    RAISE EXCEPTION 'Only tenant owners can complete owner setup tracking'
      USING ERRCODE = '42501';
  END IF;

  SELECT tos.owner_setup_completed_at
    INTO v_existing_completed_at
  FROM public.tenant_onboarding_status tos
  WHERE tos.tenant_id = v_profile.tenant_id;

  RETURN QUERY
  WITH upserted AS (
    INSERT INTO public.tenant_onboarding_status AS tos (
      tenant_id,
      onboarding_status,
      owner_setup_status,
      owner_setup_completed_at,
      updated_by
    ) VALUES (
      v_profile.tenant_id,
      'owner_setup_complete',
      'owner_setup_complete',
      NOW(),
      v_user_id
    )
    ON CONFLICT ON CONSTRAINT tenant_onboarding_status_tenant_id_key DO UPDATE
      SET
        owner_setup_status = 'owner_setup_complete',
        owner_setup_completed_at = COALESCE(
          tos.owner_setup_completed_at,
          EXCLUDED.owner_setup_completed_at
        ),
        onboarding_status = CASE
          WHEN tos.onboarding_status IN ('details_pending', 'owner_invited')
            THEN 'owner_setup_complete'
          ELSE tos.onboarding_status
        END,
        updated_by = EXCLUDED.updated_by
      WHERE tos.owner_setup_status IS DISTINCT FROM 'owner_setup_complete'
         OR tos.owner_setup_completed_at IS NULL
         OR tos.onboarding_status IN ('details_pending', 'owner_invited')
    RETURNING
      tos.tenant_id,
      tos.onboarding_status,
      tos.owner_setup_status,
      tos.owner_setup_completed_at
  )
  SELECT
    u.tenant_id,
    u.onboarding_status,
    u.owner_setup_status,
    u.owner_setup_completed_at,
    v_existing_completed_at IS NOT NULL AS already_completed
  FROM upserted u

  UNION ALL

  SELECT
    tos.tenant_id,
    tos.onboarding_status,
    tos.owner_setup_status,
    tos.owner_setup_completed_at,
    TRUE AS already_completed
  FROM public.tenant_onboarding_status tos
  WHERE tos.tenant_id = v_profile.tenant_id
    AND NOT EXISTS (SELECT 1 FROM upserted);
END;
$$;

COMMENT ON FUNCTION public.mark_owner_setup_complete() IS
  'Idempotently marks owner setup complete for the authenticated owner caller tenant only.';

REVOKE ALL ON FUNCTION public.mark_owner_setup_complete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_owner_setup_complete() TO authenticated;

NOTIFY pgrst, 'reload schema';
