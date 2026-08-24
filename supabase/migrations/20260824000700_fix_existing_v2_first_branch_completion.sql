-- Owner first-branch onboarding hotfix.
-- Complete the canonical V2 placeholder branch in place; never create a second branch.

CREATE OR REPLACE FUNCTION public.prepare_first_branch_provisioning(
  p_owner_id uuid, p_branch_payload jsonb
) RETURNS TABLE (provisioning_id uuid, state text, tenant_id uuid, branch_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_req public.first_branch_provisioning_requests%ROWTYPE;
  v_branch_id uuid;
  v_limit integer;
  v_name text;
  v_vat_number text;
  v_cr_number text;
  v_building_number text;
  v_postal_code text;
  v_street text;
  v_district text;
  v_city text;
  v_phone text;
BEGIN
  v_name := nullif(btrim(coalesce(p_branch_payload->>'name', '')), '');
  v_vat_number := nullif(btrim(coalesce(p_branch_payload->>'vat_number', '')), '');
  v_cr_number := nullif(btrim(coalesce(p_branch_payload->>'cr_number', '')), '');
  v_building_number := nullif(btrim(coalesce(p_branch_payload->>'building_number', '')), '');
  v_postal_code := nullif(btrim(coalesce(p_branch_payload->>'postal_code', '')), '');
  v_street := nullif(btrim(coalesce(p_branch_payload->>'street', '')), '');
  v_district := nullif(btrim(coalesce(p_branch_payload->>'district', '')), '');
  v_city := nullif(btrim(coalesce(p_branch_payload->>'city', '')), '');
  v_phone := nullif(btrim(coalesce(p_branch_payload->>'phone', '')), '');

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_NAME' USING ERRCODE = '22023';
  END IF;
  IF v_vat_number IS NULL OR v_vat_number !~ '^3[0-9]{13}3$' THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_VAT' USING ERRCODE = '22023';
  END IF;
  IF v_cr_number IS NULL OR v_cr_number !~ '^[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_CR' USING ERRCODE = '22023';
  END IF;
  IF v_building_number IS NULL OR v_building_number !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_BUILDING' USING ERRCODE = '22023';
  END IF;
  IF v_postal_code IS NULL OR v_postal_code !~ '^[0-9]{5}$' THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_POSTAL' USING ERRCODE = '22023';
  END IF;
  IF v_street IS NULL THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_STREET' USING ERRCODE = '22023';
  END IF;
  IF v_district IS NULL THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_DISTRICT' USING ERRCODE = '22023';
  END IF;
  IF v_city IS NULL THEN
    RAISE EXCEPTION 'FIRST_BRANCH_INVALID_CITY' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile FROM public.user_profiles WHERE id = p_owner_id FOR UPDATE;
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') OR v_profile.is_active IS NOT TRUE
     OR v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'FIRST_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_profile.tenant_id::text, 704220));
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_profile.tenant_id AND is_active IS TRUE) THEN
    RAISE EXCEPTION 'TENANT_INACTIVE' USING ERRCODE = '42501';
  END IF;
  SELECT least(t.max_branches, p.max_branches) INTO v_limit
  FROM public.tenants t
  JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
    AND s.status IN ('trial','active') AND s.cancelled_at IS NULL
  JOIN public.subscription_plans p ON p.id = s.plan_id AND p.is_active IS TRUE
  WHERE t.id = v_profile.tenant_id;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_REQUIRED'; END IF;

  SELECT f.* INTO v_req FROM public.first_branch_provisioning_requests f
    WHERE f.tenant_id = v_profile.tenant_id FOR UPDATE;
  SELECT b.id INTO v_branch_id FROM public.branches b
    WHERE b.tenant_id = v_profile.tenant_id AND b.is_main_branch IS TRUE FOR UPDATE;
  IF v_branch_id IS NULL THEN
    IF (SELECT count(*) FROM public.branches b WHERE b.tenant_id = v_profile.tenant_id) >= v_limit THEN
      RAISE EXCEPTION 'BRANCH_LIMIT_REACHED';
    END IF;
    -- Preserve the established zero-branch onboarding contract.
    INSERT INTO public.branches (
      tenant_id, name, vat_number, cr_number, building_number, postal_code,
      street, district, city, phone, country, is_main_branch, is_active,
      vat_mode, invoice_prefix, invoice_language, show_logo, zatca_phase
    ) VALUES (
      v_profile.tenant_id, v_name, v_vat_number, v_cr_number, v_building_number,
      v_postal_code, v_street, v_district, v_city, v_phone, 'SA', true, true,
      'exclusive', 'INV', 'both', true,
      CASE WHEN (p_branch_payload->>'zatca_phase')::integer = 2 THEN 2 ELSE 1 END
    ) RETURNING id INTO v_branch_id;
  ELSE
    -- V2 already created the canonical placeholder. Complete it in place.
    -- Fiscal policy columns are intentionally absent: they remain server-authoritative.
    UPDATE public.branches AS b SET
      name = v_name,
      business_name = v_name,
      vat_number = v_vat_number,
      cr_number = v_cr_number,
      building_number = v_building_number,
      postal_code = v_postal_code,
      street = v_street,
      district = v_district,
      city = v_city,
      phone = v_phone
    WHERE b.id = v_branch_id AND b.tenant_id = v_profile.tenant_id
    RETURNING b.id INTO v_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FIRST_BRANCH_NOT_FOUND';
    END IF;
  END IF;

  IF v_req.id IS NULL THEN
    INSERT INTO public.first_branch_provisioning_requests (
      tenant_id, initiated_by, branch_id, branch_payload, state
    ) VALUES (v_profile.tenant_id, p_owner_id, v_branch_id,
      jsonb_strip_nulls(p_branch_payload), 'branch_ready')
    RETURNING * INTO v_req;
  ELSE
    IF v_req.branch_id IS NOT NULL AND v_req.branch_id <> v_branch_id THEN
      RAISE EXCEPTION 'FIRST_BRANCH_AMBIGUOUS';
    END IF;
    UPDATE public.first_branch_provisioning_requests f SET
      branch_id = v_branch_id, attempt_count = f.attempt_count + 1,
      state = CASE WHEN f.state = 'complete' THEN f.state ELSE 'branch_ready' END,
      updated_at = now()
    WHERE f.id = v_req.id RETURNING * INTO v_req;
  END IF;
  RETURN QUERY SELECT v_req.id, v_req.state, v_req.tenant_id, v_branch_id;
END
$$;

