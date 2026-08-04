-- Preserve the Super Admin's selected branch allowance as the authoritative
-- provisioning contract. Plan capacity is catalogue metadata and must never
-- override this per-tenant entitlement. This migration has not been applied to
-- a shared database, but production contains a compatible partial DDL state.
-- Validate that state explicitly: accept equivalent objects, add only missing
-- objects, and stop before changing a semantically different entitlement.
DO $$
DECLARE
  v_type text;
  v_not_null boolean;
  v_default text;
  v_definition text;
  v_normalized_definition text;
  v_equivalent_check boolean;
  v_incompatible_check boolean;
BEGIN
  IF to_regclass('public.owner_provisioning_requests') IS NULL
     OR to_regclass('public.tenant_subscriptions') IS NULL
     OR to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'ENTITLEMENT_PREREQUISITE_RELATION_MISSING';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_not_null, v_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.owner_provisioning_requests'::regclass
    AND a.attname = 'branch_allowance'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT FOUND THEN
    ALTER TABLE public.owner_provisioning_requests
      ADD COLUMN branch_allowance integer;
  ELSIF v_type <> 'integer' OR v_not_null OR v_default IS NOT NULL THEN
    RAISE EXCEPTION 'INCOMPATIBLE_BRANCH_ALLOWANCE_DEFINITION: type %, not_null %, default %',
      v_type, v_not_null, coalesce(v_default, '<NULL>');
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_not_null, v_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.tenant_subscriptions'::regclass
    AND a.attname = 'paid_branch_count'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT FOUND THEN
    ALTER TABLE public.tenant_subscriptions
      ADD COLUMN paid_branch_count integer NOT NULL DEFAULT 1;
  ELSIF v_type <> 'integer' OR NOT v_not_null OR v_default IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'INCOMPATIBLE_PAID_BRANCH_COUNT_DEFINITION: type %, not_null %, default %',
      v_type, v_not_null, coalesce(v_default, '<NULL>');
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_not_null, v_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.tenants'::regclass
    AND a.attname = 'vat_number'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT FOUND OR v_type NOT IN ('character varying(15)', 'character varying', 'text')
     OR v_default IS NOT NULL THEN
    RAISE EXCEPTION 'INCOMPATIBLE_TENANT_VAT_DEFINITION: type %, default %',
      coalesce(v_type, '<MISSING>'), coalesce(v_default, '<NULL>');
  END IF;
  IF v_not_null THEN
    -- v74 canonicalises a blank VAT to NULL; this changes no existing value.
    ALTER TABLE public.tenants ALTER COLUMN vat_number DROP NOT NULL;
  END IF;

  v_equivalent_check := false;
  v_incompatible_check := false;
  FOR v_definition IN
    SELECT pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    WHERE c.conrelid = 'public.tenant_subscriptions'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%paid_branch_count%'
  LOOP
    v_normalized_definition := regexp_replace(lower(v_definition), '[[:space:]()]', '', 'g');
    IF v_normalized_definition = 'checkpaid_branch_count>=1' THEN
      v_equivalent_check := true;
    ELSE
      v_incompatible_check := true;
    END IF;
  END LOOP;
  IF v_incompatible_check THEN
    RAISE EXCEPTION 'INCOMPATIBLE_PAID_BRANCH_COUNT_CHECK';
  ELSIF NOT v_equivalent_check THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_paid_branch_count_check
      CHECK (paid_branch_count >= 1);
  END IF;

  v_equivalent_check := false;
  v_incompatible_check := false;
  FOR v_definition IN
    SELECT pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    WHERE c.conrelid = 'public.owner_provisioning_requests'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%branch_allowance%'
  LOOP
    v_normalized_definition := regexp_replace(lower(v_definition), '[[:space:]()]', '', 'g');
    IF v_normalized_definition IN (
      'checkbranch_allowanceisnullorbranch_allowancebetween1and100',
      'checkbranch_allowanceisnullorbranch_allowance>=1andbranch_allowance<=100'
    ) THEN
      v_equivalent_check := true;
    ELSE
      v_incompatible_check := true;
    END IF;
  END LOOP;
  IF v_incompatible_check THEN
    RAISE EXCEPTION 'INCOMPATIBLE_BRANCH_ALLOWANCE_CHECK';
  ELSIF NOT v_equivalent_check THEN
    ALTER TABLE public.owner_provisioning_requests
      ADD CONSTRAINT owner_provisioning_requests_branch_allowance_check
      CHECK (branch_allowance IS NULL OR branch_allowance BETWEEN 1 AND 100);
  END IF;

  IF to_regprocedure('public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.complete_owner_provisioning_core(uuid)') IS NULL
     OR to_regprocedure('public.attach_owner_provisioning_auth(uuid,uuid)') IS NULL
     OR to_regprocedure('public.set_owner_provisioning_result(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'INCOMPATIBLE_ENTITLEMENT_FUNCTION_SIGNATURE';
  END IF;
  IF pg_get_function_result(to_regprocedure('public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb)'))
       <> 'TABLE(provisioning_id uuid, state text, auth_user_id uuid, tenant_id uuid, subscription_id uuid, is_replay boolean)'
     OR pg_get_function_result(to_regprocedure('public.complete_owner_provisioning_core(uuid)'))
       <> 'TABLE(state text, auth_user_id uuid, tenant_id uuid, subscription_id uuid)' THEN
    RAISE EXCEPTION 'INCOMPATIBLE_ENTITLEMENT_FUNCTION_RETURN_SIGNATURE';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.acquire_owner_provisioning(
  p_initiated_by uuid,
  p_normalized_email text,
  p_plan_id uuid,
  p_request_fingerprint text,
  p_request_payload jsonb
) RETURNS TABLE (
  provisioning_id uuid, state text, auth_user_id uuid, tenant_id uuid,
  subscription_id uuid, is_replay boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_row public.owner_provisioning_requests%ROWTYPE;
  v_branch_allowance integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_initiated_by AND role = 'super_admin' AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'PROVISIONING_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_normalized_email IS NULL
     OR p_normalized_email <> lower(btrim(p_normalized_email))
     OR position('@' IN p_normalized_email) <= 1 THEN
    RAISE EXCEPTION 'INVALID_OWNER_EMAIL' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_request_payload) <> 'object'
     OR jsonb_typeof(p_request_payload -> 'branch_count') <> 'number'
     OR coalesce(p_request_payload ->> 'branch_count', '') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'INVALID_BRANCH_ALLOWANCE' USING ERRCODE = '22023';
  END IF;
  v_branch_allowance := (p_request_payload ->> 'branch_count')::integer;
  IF v_branch_allowance NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'INVALID_BRANCH_ALLOWANCE' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.owner_provisioning_plan_allowlist a
    JOIN public.subscription_plans p ON p.id = a.plan_id
    WHERE a.plan_id = p_plan_id AND a.enabled IS TRUE AND p.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'PLAN_NOT_ELIGIBLE' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_normalized_email, 704219));
  SELECT * INTO v_row FROM public.owner_provisioning_requests
  WHERE normalized_email = p_normalized_email FOR UPDATE;

  IF FOUND THEN
    IF v_row.branch_allowance IS NULL THEN
      -- A request created before this contract cannot safely be assigned a
      -- branch entitlement retrospectively; retain it for human review.
      RAISE EXCEPTION 'LEGACY_BRANCH_ALLOWANCE_REVIEW_REQUIRED' USING ERRCODE = '55000';
    END IF;
    IF v_row.request_fingerprint <> p_request_fingerprint
       OR v_row.plan_id <> p_plan_id
       OR v_row.branch_allowance IS DISTINCT FROM v_branch_allowance THEN
      RAISE EXCEPTION 'PROVISIONING_REQUEST_CONFLICT' USING ERRCODE = '23505';
    END IF;
    UPDATE public.owner_provisioning_requests
      SET attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN QUERY SELECT v_row.id, v_row.state, v_row.auth_user_id,
      v_row.tenant_id, v_row.subscription_id, true;
    RETURN;
  END IF;

  INSERT INTO public.owner_provisioning_requests (
    normalized_email, request_fingerprint, initiated_by, plan_id,
    request_payload, branch_allowance
  ) VALUES (
    p_normalized_email, p_request_fingerprint, p_initiated_by, p_plan_id,
    jsonb_strip_nulls(p_request_payload), v_branch_allowance
  ) RETURNING * INTO v_row;
  RETURN QUERY SELECT v_row.id, v_row.state, v_row.auth_user_id,
    v_row.tenant_id, v_row.subscription_id, false;
END
$$;

CREATE OR REPLACE FUNCTION public.complete_owner_provisioning_core(
  p_provisioning_id uuid
) RETURNS TABLE (state text, auth_user_id uuid, tenant_id uuid, subscription_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_req public.owner_provisioning_requests%ROWTYPE;
  v_tenant_id uuid;
  v_subscription_id uuid;
  v_payload jsonb;
  v_branch_allowance integer;
BEGIN
  SELECT * INTO v_req FROM public.owner_provisioning_requests
    WHERE id = p_provisioning_id FOR UPDATE;
  IF NOT FOUND OR v_req.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_READY' USING ERRCODE = '55000';
  END IF;
  IF v_req.branch_allowance IS NULL OR v_req.branch_allowance NOT BETWEEN 1 AND 100 THEN
    -- Do not reinterpret legacy incomplete requests using a plan-wide fallback.
    RAISE EXCEPTION 'BRANCH_ALLOWANCE_MISSING' USING ERRCODE = '55000';
  END IF;
  v_branch_allowance := v_req.branch_allowance;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = v_req.auth_user_id AND lower(email) = v_req.normalized_email
      AND raw_user_meta_data->>'owner_provisioning_id' = v_req.id::text
  ) THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.subscription_plans p
    JOIN public.owner_provisioning_plan_allowlist a ON a.plan_id = p.id
    WHERE p.id = v_req.plan_id AND p.is_active IS TRUE AND a.enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'PLAN_NOT_ELIGIBLE';
  END IF;
  v_payload := v_req.request_payload;

  SELECT up.tenant_id INTO v_tenant_id FROM public.user_profiles up
  WHERE up.id = v_req.auth_user_id FOR UPDATE;
  IF v_tenant_id IS NOT NULL AND v_req.tenant_id IS NOT NULL
     AND v_tenant_id <> v_req.tenant_id THEN
    RAISE EXCEPTION 'OWNER_TENANT_CONFLICT';
  END IF;
  v_tenant_id := coalesce(v_req.tenant_id, v_tenant_id);
  IF v_tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = v_tenant_id
      AND t.max_branches IS DISTINCT FROM v_branch_allowance
  ) THEN
    RAISE EXCEPTION 'BRANCH_ENTITLEMENT_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants (
      name, name_ar, vat_number, cr_number, email, phone, city, address,
      country, is_active, max_branches, business_type
    ) VALUES (
      btrim(v_payload->>'company_name'), nullif(btrim(v_payload->>'company_name_ar'), ''),
      nullif(btrim(v_payload->>'vat_number'), ''), nullif(btrim(v_payload->>'cr_number'), ''),
      v_req.normalized_email, nullif(btrim(v_payload->>'phone'), ''),
      nullif(btrim(v_payload->>'city'), ''), nullif(btrim(v_payload->>'notes'), ''),
      'SA', true, v_branch_allowance,
      CASE WHEN v_payload->>'business_type' = 'service' THEN 'service' ELSE 'trading' END
    ) RETURNING id INTO v_tenant_id;
  END IF;

  INSERT INTO public.user_profiles (id, role, tenant_id, branch_id, full_name, email, is_active)
  VALUES (v_req.auth_user_id, 'owner', v_tenant_id, NULL,
    btrim(v_payload->>'company_name'), v_req.normalized_email, true)
  ON CONFLICT (id) DO UPDATE SET
    role = 'owner', tenant_id = EXCLUDED.tenant_id, branch_id = NULL,
    full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    is_active = true, updated_at = now()
  WHERE public.user_profiles.tenant_id IS NULL
     OR public.user_profiles.tenant_id = EXCLUDED.tenant_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up WHERE up.id = v_req.auth_user_id
      AND up.tenant_id = v_tenant_id AND up.role = 'owner' AND up.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'OWNER_PROFILE_CONFLICT'; END IF;

  SELECT ts.id INTO v_subscription_id FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = v_tenant_id AND ts.status IN ('trial', 'active')
    AND ts.cancelled_at IS NULL FOR UPDATE;
  IF v_subscription_id IS NULL THEN
    INSERT INTO public.tenant_subscriptions (
      tenant_id, plan_id, status, starts_at, ends_at, trial_ends_at,
      cancelled_at, moyasar_subscription_id, paid_branch_count
    ) VALUES (
      v_tenant_id, v_req.plan_id, 'active', now(),
      CASE WHEN coalesce((v_payload->>'duration_months')::integer, 0) = 0
        THEN NULL ELSE nullif(v_payload->>'ends_at', '')::timestamptz END,
      NULL, NULL,
      CASE WHEN coalesce((v_payload->>'duration_months')::integer, 0) = 0
        THEN 'Lifetime Free'
        ELSE nullif(concat_ws(' · ', nullif(v_payload->>'pay_method',''), nullif(v_payload->>'pay_ref','')), '') END,
      v_branch_allowance
    ) RETURNING id INTO v_subscription_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.tenant_subscriptions ts
    WHERE ts.id = v_subscription_id
      AND ts.plan_id = v_req.plan_id
      AND ts.paid_branch_count = v_branch_allowance
  ) THEN
    RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_CONFLICT' USING ERRCODE = '23505';
  END IF;

  UPDATE public.owner_provisioning_requests SET
    tenant_id = v_tenant_id, subscription_id = v_subscription_id,
    state = 'subscription_ready', last_error_code = NULL, updated_at = now()
  WHERE id = v_req.id;
  RETURN QUERY SELECT 'subscription_ready'::text, v_req.auth_user_id,
    v_tenant_id, v_subscription_id;
END
$$;

REVOKE ALL ON FUNCTION public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_owner_provisioning_core(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_owner_provisioning_core(uuid)
  TO service_role;

COMMENT ON COLUMN public.owner_provisioning_requests.branch_allowance IS
  'Validated Super Admin branch entitlement snapshot; tenant.max_branches is its runtime enforcement projection.';
