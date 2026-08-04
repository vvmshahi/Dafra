import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const localConfig = readFileSync(resolve('supabase/config.toml'), 'utf8')
const localDbPort = localConfig.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)\s*$/m)?.[1] ?? '54322'
const databaseUrl = process.env.KUBRI_ENTITLEMENT_DATABASE_URL
  ?? `postgresql://postgres:postgres@127.0.0.1:${localDbPort}/postgres`
const psql = process.env.PSQL_BIN
  ?? ['/opt/homebrew/opt/libpq/bin/psql', '/opt/homebrew/bin/psql', '/usr/local/bin/psql', 'psql']
    .find(candidate => candidate === 'psql' || existsSync(candidate))

const sql = String.raw`
BEGIN;

DO $runtime$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_plan_id uuid := gen_random_uuid();
  v_owner_id uuid;
  v_request_id uuid;
  v_retry_id uuid;
  v_tenant_id uuid;
  v_subscription_id uuid;
  v_count integer;
  v_payment_type text;
  v_duration integer;
  v_replay boolean;
  v_max_branches integer;
  v_paid_branches integer;
  v_vat text;
  v_active_branches integer;
  v_remaining_branches integer;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_admin_id, 'authenticated', 'authenticated', 'super-admin@entitlement.test', '', now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')), '{}'::jsonb, now(), now()
  );
  INSERT INTO public.user_profiles (id, role, full_name, email, is_active)
  VALUES (v_admin_id, 'super_admin', 'Entitlement Super Admin', 'super-admin@entitlement.test', true);
  INSERT INTO public.subscription_plans (
    id, name, price_monthly, price_yearly, max_branches, max_users, max_products, is_active
  ) VALUES (v_plan_id, 'Phase 2 validation', 17.50, 175.00, 999, 100, 1000, true);
  INSERT INTO public.owner_provisioning_plan_allowlist (plan_id, enabled, added_by)
  VALUES (v_plan_id, true, v_admin_id);

  FOREACH v_count IN ARRAY ARRAY[1, 3, 100] LOOP
    v_owner_id := gen_random_uuid();
    v_payment_type := CASE v_count WHEN 1 THEN 'lifetime_free' WHEN 3 THEN 'one_time' ELSE 'monthly' END;
    v_duration := CASE WHEN v_payment_type = 'lifetime_free' THEN 0 ELSE 1 END;
    v_vat := CASE WHEN v_count = 1 THEN NULL ELSE format('VAT-%s', v_count) END;

    SELECT provisioning_id, is_replay
      INTO v_request_id, v_replay
    FROM public.acquire_owner_provisioning(
      v_admin_id,
      format('owner-%s@entitlement.test', v_count),
      v_plan_id,
      format('fingerprint-%s', v_count),
      jsonb_build_object(
        'company_name', format('Entitlement %s', v_count),
        'vat_number', v_vat,
        'business_type', 'trading',
        'branch_count', v_count,
        'payment_type', v_payment_type,
        'duration_months', v_duration,
        'pay_method', 'Manual',
        'pay_ref', format('REF-%s', v_count)
      )
    );
    IF v_replay THEN RAISE EXCEPTION 'first acquisition unexpectedly replayed'; END IF;

    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_owner_id, 'authenticated', 'authenticated', format('owner-%s@entitlement.test', v_count), '', now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('owner_provisioning_id', v_request_id::text), now(), now()
    );

    -- A profile-only partial operation must still reconcile to the same tenant.
    IF v_count = 100 THEN
      INSERT INTO public.user_profiles (id, role, full_name, email, is_active)
      VALUES (v_owner_id, 'owner', 'Profile-only partial', format('owner-%s@entitlement.test', v_count), true);
    END IF;

    PERFORM public.attach_owner_provisioning_auth(v_request_id, v_owner_id);
    SELECT tenant_id, subscription_id
      INTO v_tenant_id, v_subscription_id
    FROM public.complete_owner_provisioning_core(v_request_id);

    SELECT max_branches, vat_number INTO v_max_branches, v_vat
    FROM public.tenants WHERE id = v_tenant_id;
    SELECT paid_branch_count INTO v_paid_branches
    FROM public.tenant_subscriptions WHERE id = v_subscription_id;
    IF v_max_branches <> v_count OR v_paid_branches <> v_count THEN
      RAISE EXCEPTION 'entitlement projection mismatch: %, %, expected %', v_max_branches, v_paid_branches, v_count;
    END IF;
    IF v_count = 1 AND v_vat IS NOT NULL THEN
      RAISE EXCEPTION 'blank VAT was not normalized to NULL';
    END IF;

    SELECT provisioning_id, is_replay
      INTO v_retry_id, v_replay
    FROM public.acquire_owner_provisioning(
      v_admin_id, format('owner-%s@entitlement.test', v_count), v_plan_id,
      format('fingerprint-%s', v_count),
      jsonb_build_object(
        'company_name', format('Entitlement %s', v_count), 'vat_number', v_vat,
        'business_type', 'trading', 'branch_count', v_count,
        'payment_type', v_payment_type, 'duration_months', v_duration,
        'pay_method', 'Manual', 'pay_ref', format('REF-%s', v_count)
      )
    );
    IF v_retry_id <> v_request_id OR v_replay IS NOT TRUE THEN
      RAISE EXCEPTION 'identical request did not replay';
    END IF;

    IF v_count = 3 THEN
      BEGIN
        PERFORM public.acquire_owner_provisioning(
          v_admin_id, 'owner-3@entitlement.test', v_plan_id, 'fingerprint-3-conflict',
          jsonb_build_object('company_name', 'Entitlement 3', 'vat_number', 'VAT-3',
            'business_type', 'trading', 'branch_count', 4, 'payment_type', 'one_time', 'duration_months', 1)
        );
        RAISE EXCEPTION 'conflicting replay was accepted';
      EXCEPTION WHEN unique_violation THEN NULL;
      END;

      IF 17.50 * v_paid_branches <> 52.50 THEN
        RAISE EXCEPTION 'three-branch pricing projection mismatch';
      END IF;

      PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
      PERFORM public.create_branch_for_tenant(jsonb_build_object('name', 'Branch 1', 'country', 'SA'));
      PERFORM public.create_branch_for_tenant(jsonb_build_object('name', 'Branch 2', 'country', 'SA'));
      PERFORM public.create_branch_for_tenant(jsonb_build_object('name', 'Branch 3', 'country', 'SA'));
      SELECT active_branch_count, remaining_branches
        INTO v_active_branches, v_remaining_branches
      FROM public.get_tenant_branch_usage(v_tenant_id);
      IF v_active_branches <> 3 OR v_remaining_branches <> 0 THEN
        RAISE EXCEPTION 'branch usage expected 3/3, got active %, remaining %', v_active_branches, v_remaining_branches;
      END IF;
      BEGIN
        PERFORM public.create_branch_for_tenant(jsonb_build_object('name', 'Branch 4', 'country', 'SA'));
        RAISE EXCEPTION 'fourth branch was accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
      SELECT active_branch_count, max_branches INTO v_active_branches, v_max_branches
      FROM public.get_tenant_branch_usage(v_tenant_id);
      IF v_active_branches <> 3 OR v_max_branches <> 3 THEN
        RAISE EXCEPTION 're-read did not preserve 3-branch capacity';
      END IF;
    END IF;
  END LOOP;

  -- Invalid, omitted, decimal, string, out-of-range, and unauthorised calls must fail server-side.
  FOR v_count IN SELECT unnest(ARRAY[0, -1, 101]) LOOP
    BEGIN
      PERFORM public.acquire_owner_provisioning(v_admin_id, format('invalid-%s@entitlement.test', v_count), v_plan_id,
        format('invalid-%s', v_count), jsonb_build_object('company_name', 'Invalid', 'branch_count', v_count));
      RAISE EXCEPTION 'invalid branch count % was accepted', v_count;
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM public.acquire_owner_provisioning(v_admin_id, 'decimal@entitlement.test', v_plan_id, 'decimal',
      jsonb_build_object('company_name', 'Decimal', 'branch_count', 3.5));
    RAISE EXCEPTION 'decimal branch count was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.acquire_owner_provisioning(v_admin_id, 'omitted@entitlement.test', v_plan_id, 'omitted',
      jsonb_build_object('company_name', 'Omitted'));
    RAISE EXCEPTION 'omitted branch count was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.acquire_owner_provisioning(v_admin_id, 'string@entitlement.test', v_plan_id, 'string',
      jsonb_build_object('company_name', 'String', 'branch_count', '3'));
    RAISE EXCEPTION 'string branch count was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.acquire_owner_provisioning(gen_random_uuid(), 'forbidden@entitlement.test', v_plan_id, 'forbidden',
      jsonb_build_object('company_name', 'Forbidden', 'branch_count', 3));
    RAISE EXCEPTION 'unauthorised caller was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.owner_provisioning_requests (
    normalized_email, request_fingerprint, initiated_by, plan_id, request_payload, branch_allowance
  ) VALUES ('legacy@entitlement.test', 'legacy-fingerprint', v_admin_id, v_plan_id,
    jsonb_build_object('company_name', 'Legacy partial'), NULL);
  BEGIN
    PERFORM public.acquire_owner_provisioning(v_admin_id, 'legacy@entitlement.test', v_plan_id, 'legacy-fingerprint',
      jsonb_build_object('company_name', 'Legacy partial', 'branch_count', 3));
    RAISE EXCEPTION 'ambiguous legacy request was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$runtime$;

ROLLBACK;
SELECT 'owner branch-entitlement runtime: PASS' AS result;
`

const output = execFileSync(psql, [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], {
  input: sql,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
})

assert.match(output, /owner branch-entitlement runtime: PASS/)
console.log('owner branch-entitlement runtime: PASS')
