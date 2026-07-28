-- Phase 1: resumable owner and first-branch provisioning.
-- Additive only. This migration deliberately aborts before creating unique
-- indexes when existing rows violate the intended invariants.

BEGIN;

DO $$
DECLARE
  v_duplicate_main_tenants bigint;
  v_duplicate_live_subscriptions bigint;
BEGIN
  SELECT count(*) INTO v_duplicate_main_tenants
  FROM (
    SELECT tenant_id FROM public.branches
    WHERE is_main_branch IS TRUE
    GROUP BY tenant_id HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO v_duplicate_live_subscriptions
  FROM (
    SELECT tenant_id FROM public.tenant_subscriptions
    WHERE status IN ('trial', 'active') AND cancelled_at IS NULL
    GROUP BY tenant_id HAVING count(*) > 1
  ) d;

  IF v_duplicate_main_tenants > 0 OR v_duplicate_live_subscriptions > 0 THEN
    RAISE EXCEPTION
      'PHASE1_PREFLIGHT_FAILED duplicate_main_tenants=% duplicate_live_subscription_tenants=%',
      v_duplicate_main_tenants, v_duplicate_live_subscriptions;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS branches_one_main_per_tenant_uidx
  ON public.branches (tenant_id)
  WHERE is_main_branch IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_one_live_per_tenant_uidx
  ON public.tenant_subscriptions (tenant_id)
  WHERE status IN ('trial', 'active') AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS public.owner_provisioning_plan_allowlist (
  plan_id uuid PRIMARY KEY REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.owner_provisioning_plan_allowlist (plan_id)
SELECT id FROM public.subscription_plans WHERE is_active IS TRUE
ON CONFLICT (plan_id) DO NOTHING;

ALTER TABLE public.owner_provisioning_plan_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_provisioning_plan_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.owner_provisioning_plan_allowlist TO service_role;

CREATE TABLE IF NOT EXISTS public.owner_provisioning_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL,
  request_fingerprint text NOT NULL,
  initiated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NULL REFERENCES public.tenant_subscriptions(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'requested',
  last_error_code text NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  setup_link_ready_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_provisioning_email_normalized CHECK (
    normalized_email = lower(btrim(normalized_email)) AND position('@' IN normalized_email) > 1
  ),
  CONSTRAINT owner_provisioning_state_check CHECK (state IN (
    'requested', 'auth_user_ready', 'tenant_ready', 'profile_ready',
    'subscription_ready', 'setup_link_ready', 'complete',
    'failed_recoverable', 'failed_manual_review'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_provisioning_normalized_email_uidx
  ON public.owner_provisioning_requests (normalized_email);
CREATE INDEX IF NOT EXISTS owner_provisioning_state_idx
  ON public.owner_provisioning_requests (state, updated_at);

ALTER TABLE public.owner_provisioning_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_provisioning_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.owner_provisioning_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.first_branch_provisioning_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE RESTRICT,
  initiated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  normalized_username text NULL,
  internal_auth_email text NULL,
  branch_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'requested',
  last_error_code text NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT first_branch_state_check CHECK (state IN (
    'requested', 'branch_ready', 'auth_user_ready', 'profile_ready',
    'username_mapping_ready', 'complete', 'failed_recoverable',
    'failed_manual_review'
  )),
  CONSTRAINT first_branch_username_normalized CHECK (
    normalized_username IS NULL OR normalized_username = public.normalize_branch_login_username(normalized_username)
  )
);

CREATE INDEX IF NOT EXISTS first_branch_provisioning_state_idx
  ON public.first_branch_provisioning_requests (state, updated_at);
ALTER TABLE public.first_branch_provisioning_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.first_branch_provisioning_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.first_branch_provisioning_requests TO service_role;

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
    IF v_row.request_fingerprint <> p_request_fingerprint OR v_row.plan_id <> p_plan_id THEN
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
    normalized_email, request_fingerprint, initiated_by, plan_id, request_payload
  ) VALUES (
    p_normalized_email, p_request_fingerprint, p_initiated_by, p_plan_id,
    jsonb_strip_nulls(p_request_payload)
  ) RETURNING * INTO v_row;
  RETURN QUERY SELECT v_row.id, v_row.state, v_row.auth_user_id,
    v_row.tenant_id, v_row.subscription_id, false;
END
$$;

CREATE OR REPLACE FUNCTION public.attach_owner_provisioning_auth(
  p_provisioning_id uuid, p_auth_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE v_req public.owner_provisioning_requests%ROWTYPE; v_auth auth.users%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.owner_provisioning_requests
    WHERE id = p_provisioning_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVISIONING_NOT_FOUND'; END IF;
  SELECT * INTO v_auth FROM auth.users WHERE id = p_auth_user_id;
  IF NOT FOUND OR lower(v_auth.email) <> v_req.normalized_email THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_auth.raw_user_meta_data->>'owner_provisioning_id', '') <> v_req.id::text THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_UNRELATED' USING ERRCODE = '42501';
  END IF;
  IF v_req.auth_user_id IS NOT NULL AND v_req.auth_user_id <> p_auth_user_id THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_AMBIGUOUS';
  END IF;
  UPDATE public.owner_provisioning_requests
    SET auth_user_id = p_auth_user_id, state = 'auth_user_ready',
        last_error_code = NULL, updated_at = now()
    WHERE id = p_provisioning_id;
  RETURN 'auth_user_ready';
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
  v_plan public.subscription_plans%ROWTYPE;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_req FROM public.owner_provisioning_requests
    WHERE id = p_provisioning_id FOR UPDATE;
  IF NOT FOUND OR v_req.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_READY' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = v_req.auth_user_id AND lower(email) = v_req.normalized_email
      AND raw_user_meta_data->>'owner_provisioning_id' = v_req.id::text
  ) THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_MISMATCH';
  END IF;
  SELECT p.* INTO v_plan
  FROM public.subscription_plans p
  JOIN public.owner_provisioning_plan_allowlist a ON a.plan_id = p.id
  WHERE p.id = v_req.plan_id AND p.is_active IS TRUE AND a.enabled IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_ELIGIBLE'; END IF;
  v_payload := v_req.request_payload;

  SELECT up.tenant_id INTO v_tenant_id FROM public.user_profiles up
  WHERE up.id = v_req.auth_user_id FOR UPDATE;
  IF v_tenant_id IS NOT NULL AND v_req.tenant_id IS NOT NULL
     AND v_tenant_id <> v_req.tenant_id THEN
    RAISE EXCEPTION 'OWNER_TENANT_CONFLICT';
  END IF;
  v_tenant_id := coalesce(v_req.tenant_id, v_tenant_id);
  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants (
      name, name_ar, vat_number, cr_number, email, phone, city, address,
      country, is_active, max_branches, business_type
    ) VALUES (
      btrim(v_payload->>'company_name'), nullif(btrim(v_payload->>'company_name_ar'), ''),
      btrim(v_payload->>'vat_number'), nullif(btrim(v_payload->>'cr_number'), ''),
      v_req.normalized_email, nullif(btrim(v_payload->>'phone'), ''),
      nullif(btrim(v_payload->>'city'), ''), nullif(btrim(v_payload->>'notes'), ''),
      'SA', true, greatest(1, v_plan.max_branches),
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
      cancelled_at, moyasar_subscription_id
    ) VALUES (
      v_tenant_id, v_req.plan_id, 'active', now(),
      CASE WHEN coalesce((v_payload->>'duration_months')::integer, 0) = 0
        THEN NULL ELSE nullif(v_payload->>'ends_at', '')::timestamptz END,
      NULL, NULL,
      CASE WHEN coalesce((v_payload->>'duration_months')::integer, 0) = 0
        THEN 'Lifetime Free'
        ELSE nullif(concat_ws(' · ', nullif(v_payload->>'pay_method',''), nullif(v_payload->>'pay_ref','')), '') END
    ) RETURNING id INTO v_subscription_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.tenant_subscriptions ts
    WHERE ts.id = v_subscription_id AND ts.plan_id = v_req.plan_id
  ) THEN RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_CONFLICT'; END IF;

  UPDATE public.owner_provisioning_requests SET
    tenant_id = v_tenant_id, subscription_id = v_subscription_id,
    state = 'subscription_ready', last_error_code = NULL, updated_at = now()
  WHERE id = v_req.id;
  RETURN QUERY SELECT 'subscription_ready'::text, v_req.auth_user_id,
    v_tenant_id, v_subscription_id;
END
$$;

CREATE OR REPLACE FUNCTION public.set_owner_provisioning_result(
  p_provisioning_id uuid, p_state text, p_error_code text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_state NOT IN ('setup_link_ready','complete','failed_recoverable','failed_manual_review') THEN
    RAISE EXCEPTION 'INVALID_PROVISIONING_STATE';
  END IF;
  UPDATE public.owner_provisioning_requests r SET
    state = CASE WHEN r.state = 'complete' THEN r.state ELSE p_state END,
    last_error_code = CASE WHEN r.state = 'complete' THEN NULL ELSE p_error_code END,
    setup_link_ready_at = CASE WHEN p_state IN ('setup_link_ready','complete') THEN now() ELSE setup_link_ready_at END,
    updated_at = now()
  WHERE id = p_provisioning_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVISIONING_NOT_FOUND'; END IF;
END
$$;

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
BEGIN
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
    INSERT INTO public.branches (
      tenant_id, name, vat_number, cr_number, building_number, postal_code,
      street, district, city, phone, country, is_main_branch, is_active,
      vat_mode, invoice_prefix, invoice_language, show_logo, zatca_phase
    ) VALUES (
      v_profile.tenant_id, btrim(p_branch_payload->>'name'),
      nullif(btrim(p_branch_payload->>'vat_number'),''),
      nullif(btrim(p_branch_payload->>'cr_number'),''),
      nullif(btrim(p_branch_payload->>'building_number'),''),
      nullif(btrim(p_branch_payload->>'postal_code'),''),
      nullif(btrim(p_branch_payload->>'street'),''),
      nullif(btrim(p_branch_payload->>'district'),''),
      nullif(btrim(p_branch_payload->>'city'),''),
      nullif(btrim(p_branch_payload->>'phone'),''),
      'SA', true, true, 'exclusive', 'INV', 'both', true,
      CASE WHEN (p_branch_payload->>'zatca_phase')::integer = 2 THEN 2 ELSE 1 END
    ) RETURNING id INTO v_branch_id;
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

CREATE OR REPLACE FUNCTION public.complete_first_branch_access(
  p_provisioning_id uuid, p_auth_user_id uuid, p_username text,
  p_internal_auth_email text, p_full_name text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_req public.first_branch_provisioning_requests%ROWTYPE;
  v_username text := public.normalize_branch_login_username(p_username);
BEGIN
  SELECT * INTO v_req FROM public.first_branch_provisioning_requests
    WHERE id = p_provisioning_id FOR UPDATE;
  IF NOT FOUND OR v_req.branch_id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_READY'; END IF;
  IF NOT public.is_valid_branch_login_username(v_username) THEN
    RAISE EXCEPTION 'INVALID_BRANCH_USERNAME' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_auth_user_id
      AND lower(email) = lower(p_internal_auth_email)
      AND raw_user_meta_data->>'first_branch_provisioning_id' = v_req.id::text
  ) THEN RAISE EXCEPTION 'BRANCH_AUTH_IDENTITY_UNRELATED'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.branch_login_usernames
    WHERE normalized_username = v_username AND user_id <> p_auth_user_id
  ) THEN RAISE EXCEPTION 'BRANCH_USERNAME_CONFLICT' USING ERRCODE = '23505'; END IF;

  INSERT INTO public.user_profiles (id, tenant_id, branch_id, role, full_name, email, is_active)
  VALUES (p_auth_user_id, v_req.tenant_id, v_req.branch_id, 'branch',
    btrim(p_full_name), lower(p_internal_auth_email), true)
  ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id,
    branch_id = EXCLUDED.branch_id, role = 'branch', full_name = EXCLUDED.full_name,
    email = EXCLUDED.email, is_active = true, updated_at = now()
  WHERE (public.user_profiles.tenant_id IS NULL OR public.user_profiles.tenant_id = EXCLUDED.tenant_id)
    AND (public.user_profiles.branch_id IS NULL OR public.user_profiles.branch_id = EXCLUDED.branch_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = p_auth_user_id
      AND tenant_id = v_req.tenant_id AND branch_id = v_req.branch_id AND role = 'branch'
  ) THEN RAISE EXCEPTION 'BRANCH_PROFILE_CONFLICT'; END IF;

  INSERT INTO public.branch_login_usernames (
    tenant_id, branch_id, user_id, username, normalized_username,
    internal_auth_email, is_active, created_by, updated_by
  ) VALUES (
    v_req.tenant_id, v_req.branch_id, p_auth_user_id, v_username, v_username,
    lower(p_internal_auth_email), true, v_req.initiated_by, v_req.initiated_by
  ) ON CONFLICT (normalized_username) DO UPDATE SET
    is_active = true, updated_at = now(), updated_by = EXCLUDED.updated_by
  WHERE public.branch_login_usernames.user_id = EXCLUDED.user_id
    AND public.branch_login_usernames.branch_id = EXCLUDED.branch_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.branch_login_usernames WHERE user_id = p_auth_user_id
      AND tenant_id = v_req.tenant_id AND branch_id = v_req.branch_id
      AND normalized_username = v_username AND is_active IS TRUE
  ) THEN RAISE EXCEPTION 'BRANCH_USERNAME_CONFLICT'; END IF;

  UPDATE public.first_branch_provisioning_requests SET
    auth_user_id = p_auth_user_id, normalized_username = v_username,
    internal_auth_email = lower(p_internal_auth_email), state = 'complete',
    last_error_code = NULL, updated_at = now()
  WHERE id = v_req.id;
  RETURN 'complete';
END
$$;

CREATE OR REPLACE FUNCTION public.set_first_branch_provisioning_result(
  p_provisioning_id uuid, p_state text, p_error_code text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_state NOT IN ('branch_ready','auth_user_ready','failed_recoverable','failed_manual_review') THEN
    RAISE EXCEPTION 'INVALID_PROVISIONING_STATE';
  END IF;
  UPDATE public.first_branch_provisioning_requests r
  SET state = CASE WHEN r.state = 'complete' THEN r.state ELSE p_state END,
      last_error_code = CASE WHEN r.state = 'complete' THEN NULL ELSE p_error_code END,
      updated_at = now()
  WHERE id = p_provisioning_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVISIONING_NOT_FOUND'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_first_branch_provisioning_status()
RETURNS TABLE (
  state text, branch_id uuid, access_complete boolean, error_code text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    coalesce(r.state,
      CASE WHEN b.id IS NULL THEN 'requested'
           WHEN m.user_id IS NOT NULL THEN 'complete'
           ELSE 'branch_ready' END),
    coalesce(r.branch_id, b.id),
    coalesce(r.state = 'complete', m.user_id IS NOT NULL, false),
    r.last_error_code
  FROM public.user_profiles p
  LEFT JOIN public.first_branch_provisioning_requests r ON r.tenant_id = p.tenant_id
  LEFT JOIN LATERAL (
    SELECT id FROM public.branches
    WHERE tenant_id = p.tenant_id AND is_main_branch IS TRUE LIMIT 1
  ) b ON true
  LEFT JOIN LATERAL (
    SELECT user_id FROM public.branch_login_usernames
    WHERE tenant_id = p.tenant_id AND branch_id = coalesce(r.branch_id, b.id)
      AND is_active IS TRUE LIMIT 1
  ) m ON true
  WHERE p.id = auth.uid() AND p.role = 'owner' AND p.is_active IS TRUE
$$;

REVOKE ALL ON FUNCTION public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_owner_provisioning_auth(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_owner_provisioning_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_owner_provisioning_result(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_first_branch_provisioning(uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_first_branch_access(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_first_branch_provisioning_result(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_owner_provisioning_auth(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_owner_provisioning_core(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_owner_provisioning_result(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_first_branch_provisioning(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_first_branch_access(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_first_branch_provisioning_result(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_first_branch_provisioning_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_first_branch_provisioning_status() TO authenticated, service_role;

COMMIT;
