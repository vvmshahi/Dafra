-- Disposable Branch-only Business/B2B credit certification. The complete
-- fixture is transactional and is rolled back before the success marker.
DO $certification$
DECLARE
  v_tenant uuid := '10000000-0000-4000-8000-000000000001';
  v_owner uuid := '20000000-0000-4000-8000-000000000001';
  v_branch_user uuid := '20000000-0000-4000-8000-000000000002';
  v_sibling_user uuid := '20000000-0000-4000-8000-000000000003';
  v_branch_a uuid := '30000000-0000-4000-8000-000000000001';
  v_branch_b uuid := '30000000-0000-4000-8000-000000000002';
  v_business uuid := '40000000-0000-4000-8000-000000000001';
  v_individual uuid := '40000000-0000-4000-8000-000000000002';
  v_inactive_business uuid := '40000000-0000-4000-8000-000000000003';
  v_walk_in uuid := '40000000-0000-4000-8000-000000000004';
  v_off_preflight jsonb;
  v_enabled_preflight jsonb;
  v_account_first jsonb;
  v_account_second jsonb;
  v_before bigint;
  v_after bigint;
  v_account_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant)
     OR EXISTS (SELECT 1 FROM public.branches WHERE id IN (v_branch_a, v_branch_b))
     OR EXISTS (SELECT 1 FROM public.customers WHERE id IN (v_business, v_individual, v_inactive_business))
     OR EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_owner, v_branch_user, v_sibling_user)) THEN
    RAISE EXCEPTION 'AR fixture IDs already exist; refusing to touch existing data';
  END IF;

  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
    (v_owner, 'authenticated', 'authenticated', 'branch-only-owner@example.test', now(), now()),
    (v_branch_user, 'authenticated', 'authenticated', 'branch-only-a@example.test', now(), now()),
    (v_sibling_user, 'authenticated', 'authenticated', 'branch-only-b@example.test', now(), now());
  INSERT INTO public.tenants (id, name, vat_number)
  VALUES (v_tenant, 'Branch-only credit fixture', '300000000000003');
  INSERT INTO public.branches (id, tenant_id, name, branch_code, is_main_branch, customer_credit_enabled)
  VALUES
    (v_branch_a, v_tenant, 'Branch-only A', 'BO-A', true, false),
    (v_branch_b, v_tenant, 'Branch-only B', 'BO-B', false, false);
  INSERT INTO public.user_profiles (id, tenant_id, branch_id, role, full_name, is_active)
  VALUES
    (v_owner, v_tenant, NULL, 'owner', 'Branch-only owner', true),
    (v_branch_user, v_tenant, v_branch_a, 'branch', 'Branch-only A user', true),
    (v_sibling_user, v_tenant, v_branch_b, 'branch', 'Branch-only B user', true);
  INSERT INTO public.customers (id, tenant_id, branch_id, name, business_name, company_name, customer_type, is_active)
  VALUES
    (v_business, v_tenant, v_branch_a, 'Business customer', 'Business customer LLC', 'Business customer LLC', 'business', true),
    (v_individual, v_tenant, v_branch_a, 'Individual customer', NULL, NULL, 'individual', true),
    (v_inactive_business, v_tenant, v_branch_a, 'Inactive business', 'Inactive business LLC', 'Inactive business LLC', 'business', false);

  PERFORM set_config('request.jwt.claim.sub', v_branch_user::text, true);

  SELECT public.get_customer_credit_checkout_eligibility_v1(jsonb_build_object(
    'branch_id', v_branch_a, 'customer_id', v_business
  )) INTO v_off_preflight;
  IF v_off_preflight->>'reasonCode' <> 'BRANCH_CREDIT_DISABLED'
     OR (v_off_preflight->>'eligible')::boolean IS TRUE
     OR (v_off_preflight->>'account_ready')::boolean IS TRUE
     OR EXISTS (SELECT 1 FROM public.customers WHERE id = v_business AND receivable_account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'AR fixture: disabled Branch was not rejected without account setup';
  END IF;

  PERFORM public.set_branch_customer_credit_policy_v1(jsonb_build_object(
    'branch_id', v_branch_a, 'credit_enabled', true
  ));
  SELECT public.get_branch_customer_credit_policy_v1(v_branch_a) INTO v_enabled_preflight;
  IF (v_enabled_preflight->>'branchCreditEnabled')::boolean IS NOT TRUE
     OR (v_enabled_preflight->>'tenantPolicyConfigured')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'AR fixture: Branch-only gate did not persist';
  END IF;

  SELECT public.get_customer_credit_checkout_eligibility_v1(jsonb_build_object(
    'branch_id', v_branch_a, 'customer_id', v_business
  )) INTO v_enabled_preflight;
  IF v_enabled_preflight->>'reasonCode' <> 'AR_CREDIT_ELIGIBLE'
     OR (v_enabled_preflight->>'eligible')::boolean IS NOT TRUE
     OR (v_enabled_preflight->>'account_ready')::boolean IS TRUE
     OR (v_enabled_preflight->>'account_auto_create')::boolean IS NOT TRUE
     OR v_enabled_preflight->>'creditLimit' IS NOT NULL
     OR v_enabled_preflight->>'availableCredit' IS NOT NULL THEN
    RAISE EXCEPTION 'AR fixture: active Business customer did not pass Branch-only preflight: %', v_enabled_preflight;
  END IF;

  SELECT count(*) INTO v_before FROM public.customer_receivable_entries WHERE customer_id = v_business;
  SELECT public.ensure_customer_credit_account_v1(jsonb_build_object('customer_id', v_business)) INTO v_account_first;
  SELECT public.ensure_customer_credit_account_v1(jsonb_build_object('customer_id', v_business)) INTO v_account_second;
  v_account_id := (v_account_first->>'receivableAccountId')::uuid;
  SELECT count(*) INTO v_after FROM public.customer_receivable_entries WHERE customer_id = v_business;
  IF (v_account_first->>'created')::boolean IS NOT TRUE
     OR (v_account_second->>'created')::boolean IS TRUE
     OR (v_account_first->>'automatic')::boolean IS NOT TRUE
     OR (v_account_first->>'historicalBalanceBackfilled')::boolean IS TRUE
     OR v_account_id IS NULL
     OR v_account_id IS DISTINCT FROM (v_account_second->>'receivableAccountId')::uuid
     OR v_after <> v_before THEN
    RAISE EXCEPTION 'AR fixture: automatic account setup was not idempotent: % / %', v_account_first, v_account_second;
  END IF;

  SELECT public.get_customer_credit_checkout_eligibility_v1(jsonb_build_object(
    'branch_id', v_branch_a, 'customer_id', v_business
  )) INTO v_enabled_preflight;
  IF (v_enabled_preflight->>'account_ready')::boolean IS NOT TRUE
     OR (v_enabled_preflight->>'account_auto_create')::boolean IS TRUE THEN
    RAISE EXCEPTION 'AR fixture: account-ready preflight did not update';
  END IF;

  SELECT public.get_customer_credit_checkout_eligibility_v1(jsonb_build_object(
    'branch_id', v_branch_a, 'customer_id', v_individual
  )) INTO v_enabled_preflight;
  IF v_enabled_preflight->>'reasonCode' <> 'BUSINESS_CUSTOMER_REQUIRED'
     OR (v_enabled_preflight->>'eligible')::boolean IS TRUE THEN
    RAISE EXCEPTION 'AR fixture: individual customer was eligible';
  END IF;
  SELECT public.get_customer_credit_checkout_eligibility_v1(jsonb_build_object(
    'branch_id', v_branch_a, 'customer_id', v_inactive_business
  )) INTO v_enabled_preflight;
  IF v_enabled_preflight->>'reasonCode' <> 'CUSTOMER_INACTIVE'
     OR (v_enabled_preflight->>'eligible')::boolean IS TRUE THEN
    RAISE EXCEPTION 'AR fixture: inactive Business customer was eligible';
  END IF;
  BEGIN
    PERFORM public.get_customer_credit_checkout_eligibility_v1(jsonb_build_object(
      'branch_id', v_branch_a, 'customer_id', v_walk_in
    ));
    RAISE EXCEPTION 'AR fixture: walk-in/missing customer unexpectedly resolved';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'CUSTOMER_NOT_FOUND' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_sibling_user::text, true);
  BEGIN
    PERFORM public.get_customer_credit_checkout_eligibility_v1(jsonb_build_object(
      'branch_id', v_branch_a, 'customer_id', v_business
    ));
    RAISE EXCEPTION 'AR fixture: sibling Branch read unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'CREDIT_UNAUTHORIZED' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_branch_user::text, true);

  SELECT count(*) INTO v_before
  FROM (
    SELECT id FROM public.invoices
    UNION ALL SELECT id FROM public.invoice_items
    UNION ALL SELECT id FROM public.customer_receivable_operations
    UNION ALL SELECT id FROM public.customer_receivable_entries
    UNION ALL SELECT id FROM public.customer_payment_receipts
    UNION ALL SELECT id FROM public.pos_stock_movements
  ) unchanged_before;
  PERFORM public.set_branch_customer_credit_policy_v1(jsonb_build_object(
    'branch_id', v_branch_a, 'credit_enabled', false
  ));
  BEGIN
    PERFORM public.post_customer_credit_checkout_v1(jsonb_build_object(
      'operation_id', '70000000-0000-4000-8000-000000000001',
      'branch_id', v_branch_a,
      'customer_id', v_business,
      'settlement_mode', 'credit',
      'items', '[]'::jsonb
    ));
    RAISE EXCEPTION 'AR fixture: disabled Branch checkout unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'BRANCH_CREDIT_DISABLED' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_after
  FROM (
    SELECT id FROM public.invoices
    UNION ALL SELECT id FROM public.invoice_items
    UNION ALL SELECT id FROM public.customer_receivable_operations
    UNION ALL SELECT id FROM public.customer_receivable_entries
    UNION ALL SELECT id FROM public.customer_payment_receipts
    UNION ALL SELECT id FROM public.pos_stock_movements
  ) unchanged_after;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'AR fixture: rejected checkout changed business rows (% -> %)', v_before, v_after;
  END IF;
  RAISE EXCEPTION 'AR_CERTIFICATION_CLEANUP';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'AR_CERTIFICATION_CLEANUP' THEN
    DELETE FROM public.customer_payment_allocations WHERE tenant_id = v_tenant;
    DELETE FROM public.customer_payment_receipt_tenders WHERE receipt_id IN (SELECT id FROM public.customer_payment_receipts WHERE tenant_id = v_tenant);
    DELETE FROM public.customer_payment_receipts WHERE tenant_id = v_tenant;
    DELETE FROM public.customer_receivable_adjustments WHERE tenant_id = v_tenant;
    DELETE FROM public.customer_receivable_entries WHERE tenant_id = v_tenant;
    DELETE FROM public.customer_receivable_operations WHERE tenant_id = v_tenant;
    DELETE FROM public.invoice_items WHERE tenant_id = v_tenant;
    DELETE FROM public.invoices WHERE tenant_id = v_tenant;
    DELETE FROM public.pos_stock_movements WHERE tenant_id = v_tenant;
    DELETE FROM public.customer_credit_policies WHERE tenant_id = v_tenant;
    UPDATE public.customers SET receivable_account_id = NULL WHERE tenant_id = v_tenant;
    DELETE FROM public.customer_receivable_accounts WHERE tenant_id = v_tenant;
    DELETE FROM public.customers WHERE tenant_id = v_tenant;
    DELETE FROM public.user_profiles WHERE tenant_id = v_tenant;
    DELETE FROM public.branches WHERE tenant_id = v_tenant;
    DELETE FROM public.tenants WHERE id = v_tenant;
    DELETE FROM auth.users WHERE id IN (v_owner, v_branch_user, v_sibling_user);
    RAISE;
  END IF;
  DELETE FROM public.customer_payment_allocations WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_payment_receipt_tenders WHERE receipt_id IN (SELECT id FROM public.customer_payment_receipts WHERE tenant_id = v_tenant);
  DELETE FROM public.customer_payment_receipts WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_adjustments WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_entries WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_operations WHERE tenant_id = v_tenant;
  DELETE FROM public.invoice_items WHERE tenant_id = v_tenant;
  DELETE FROM public.invoices WHERE tenant_id = v_tenant;
  DELETE FROM public.pos_stock_movements WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_credit_policies WHERE tenant_id = v_tenant;
  UPDATE public.customers SET receivable_account_id = NULL WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_accounts WHERE tenant_id = v_tenant;
  DELETE FROM public.customers WHERE tenant_id = v_tenant;
  DELETE FROM public.user_profiles WHERE tenant_id = v_tenant;
  DELETE FROM public.branches WHERE tenant_id = v_tenant;
  DELETE FROM public.tenants WHERE id = v_tenant;
  DELETE FROM auth.users WHERE id IN (v_owner, v_branch_user, v_sibling_user);
  RAISE NOTICE 'BRANCH_ONLY_STATEFUL_OK';
WHEN others THEN
  DELETE FROM public.customer_payment_allocations WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_payment_receipt_tenders WHERE receipt_id IN (SELECT id FROM public.customer_payment_receipts WHERE tenant_id = v_tenant);
  DELETE FROM public.customer_payment_receipts WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_adjustments WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_entries WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_operations WHERE tenant_id = v_tenant;
  DELETE FROM public.invoice_items WHERE tenant_id = v_tenant;
  DELETE FROM public.invoices WHERE tenant_id = v_tenant;
  DELETE FROM public.pos_stock_movements WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_credit_policies WHERE tenant_id = v_tenant;
  UPDATE public.customers SET receivable_account_id = NULL WHERE tenant_id = v_tenant;
  DELETE FROM public.customer_receivable_accounts WHERE tenant_id = v_tenant;
  DELETE FROM public.customers WHERE tenant_id = v_tenant;
  DELETE FROM public.user_profiles WHERE tenant_id = v_tenant;
  DELETE FROM public.branches WHERE tenant_id = v_tenant;
  DELETE FROM public.tenants WHERE id = v_tenant;
  DELETE FROM auth.users WHERE id IN (v_owner, v_branch_user, v_sibling_user);
  RAISE;
END
$certification$;
