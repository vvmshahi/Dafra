-- ============================================================
-- Phase 4E: Branch Limit and Manual Suspension Enforcement
-- Apply manually after Phase 4B/4C/4D are in place.
-- ============================================================
--
-- Goals:
--   - Enforce tenant branch limits on branch creation server-side.
--   - Add a safe branch creation RPC for owner/admin browser flows.
--   - Block new POS checkout for manually suspended tenants.
--   - Block new register sessions for manually suspended tenants.
--   - Keep register close, existing invoices, and reporting reads available.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify tenant data.
--   - Do not auto-suspend tenants based on billing dates.
--   - Do not change invoice numbering, VAT/tax/payment math, reports, ZATCA,
--     printer, Electron, or Edge Functions.

BEGIN;

-- ============================================================
-- Branch creation backstop
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_branch_creation_limit_and_suspension()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_tenant RECORD;
  v_active_branch_count INTEGER := 0;
  v_becoming_active BOOLEAN := FALSE;
  v_old_branch_id UUID := NULL;
BEGIN
  IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_becoming_active := COALESCE(NEW.is_active, TRUE) IS TRUE;
  ELSE
    v_old_branch_id := OLD.id;
    v_becoming_active :=
      COALESCE(NEW.is_active, TRUE) IS TRUE
      AND (
        COALESCE(OLD.is_active, TRUE) IS NOT TRUE
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      );
  END IF;

  IF TG_OP = 'UPDATE' AND v_becoming_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('branch-create:' || NEW.tenant_id::text, 0));

  SELECT
    t.id,
    COALESCE(t.is_active, TRUE) AS is_active,
    t.suspended_at,
    GREATEST(COALESCE(t.max_branches, 999), 0)::integer AS max_branches
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_tenant.is_active IS NOT TRUE OR v_tenant.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'This account is suspended. New branches cannot be created.'
      USING ERRCODE = '42501';
  END IF;

  IF v_becoming_active IS TRUE THEN
    SELECT COUNT(*)::integer
      INTO v_active_branch_count
    FROM public.branches b
    WHERE b.tenant_id = NEW.tenant_id
      AND COALESCE(b.is_active, TRUE) IS TRUE
      AND (v_old_branch_id IS NULL OR b.id IS DISTINCT FROM v_old_branch_id);

    IF v_active_branch_count >= v_tenant.max_branches THEN
      RAISE EXCEPTION 'Branch limit reached. Please contact Kubri support to add more branches.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_branch_creation_limit_and_suspension() IS
  'Blocks branch creation/activation when a tenant is manually suspended or has reached max_branches.';

REVOKE ALL ON FUNCTION public.enforce_branch_creation_limit_and_suspension() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_branches_phase4e_enforce_creation ON public.branches;
CREATE TRIGGER trg_branches_phase4e_enforce_creation
  BEFORE INSERT OR UPDATE OF is_active, tenant_id ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_creation_limit_and_suspension();

-- ============================================================
-- Supported branch creation RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_branch_for_tenant(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_tenant RECORD;
  v_usage RECORD;
  v_branch public.branches%ROWTYPE;
  v_name TEXT;
  v_country TEXT;
  v_vat_mode TEXT;
  v_invoice_language TEXT;
  v_zatca_phase INTEGER;
  v_is_active BOOLEAN;
  v_show_logo BOOLEAN;
  v_is_main_branch BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid branch payload' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE OR v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only tenant owners can create branches' USING ERRCODE = '42501';
  END IF;

  SELECT
    t.id,
    COALESCE(t.is_active, TRUE) AS is_active,
    t.suspended_at
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_profile.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found' USING ERRCODE = '42501';
  END IF;

  IF v_tenant.is_active IS NOT TRUE OR v_tenant.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'This account is suspended. New branches cannot be created.'
      USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  v_country := upper(COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'country', '')), ''), 'SA'));
  v_vat_mode := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'vat_mode', '')), ''), 'exclusive');
  v_invoice_language := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'invoice_language', '')), ''), 'both');
  v_zatca_phase := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'zatca_phase', '')), '')::integer, 1);
  v_is_active := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'is_active', '')), '')::boolean, TRUE);
  v_show_logo := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'show_logo', '')), '')::boolean, TRUE);
  v_is_main_branch := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'is_main_branch', '')), '')::boolean, FALSE);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Branch name is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_country) <> 2 THEN
    RAISE EXCEPTION 'Branch country must be a two-letter code' USING ERRCODE = '22023';
  END IF;

  IF v_vat_mode NOT IN ('exclusive', 'inclusive') THEN
    RAISE EXCEPTION 'Unsupported VAT mode' USING ERRCODE = '22023';
  END IF;

  IF v_invoice_language NOT IN ('en', 'ar', 'both') THEN
    RAISE EXCEPTION 'Unsupported invoice language' USING ERRCODE = '22023';
  END IF;

  IF v_zatca_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Unsupported ZATCA phase' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_usage
  FROM public.get_tenant_branch_usage(v_profile.tenant_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant branch usage not found' USING ERRCODE = '42501';
  END IF;

  IF v_is_active IS TRUE AND v_usage.can_create_branch IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch limit reached. Please contact Kubri support to add more branches.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.branches (
    tenant_id,
    name,
    name_ar,
    business_name,
    business_name_ar,
    vat_number,
    cr_number,
    building_number,
    street,
    district,
    city,
    country,
    postal_code,
    phone,
    email,
    website,
    vat_mode,
    invoice_prefix,
    receipt_footer,
    show_logo,
    invoice_language,
    zatca_phase,
    is_active,
    is_main_branch,
    invoice_counter
  ) VALUES (
    v_profile.tenant_id,
    v_name,
    NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'business_name', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'business_name_ar', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'vat_number', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'cr_number', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'building_number', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'street', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'district', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'city', '')), ''),
    v_country,
    NULLIF(btrim(COALESCE(p_payload ->> 'postal_code', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'phone', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'email', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'website', '')), ''),
    v_vat_mode,
    COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'invoice_prefix', '')), ''), 'INV'),
    NULLIF(btrim(COALESCE(p_payload ->> 'receipt_footer', '')), ''),
    v_show_logo,
    v_invoice_language,
    v_zatca_phase,
    v_is_active,
    v_is_main_branch,
    0
  )
  RETURNING * INTO v_branch;

  RETURN to_jsonb(v_branch);
END;
$$;

COMMENT ON FUNCTION public.create_branch_for_tenant(JSONB) IS
  'Creates a branch for the caller tenant after owner/admin authorization, manual suspension check, and active branch limit check.';

REVOKE ALL ON FUNCTION public.create_branch_for_tenant(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_branch_for_tenant(JSONB) TO authenticated;

-- ============================================================
-- Register session open guard
-- ============================================================

CREATE OR REPLACE FUNCTION public.open_register_session(
  p_branch_id UUID,
  p_opening_cash NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_scope RECORD;
  v_existing RECORD;
  v_session_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_opening_cash, 0) < 0 THEN
    RAISE EXCEPTION 'Opening cash cannot be negative' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  IF v_scope.scope_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = v_scope.scope_tenant_id
      AND (
        COALESCE(t.is_active, TRUE) IS NOT TRUE
        OR t.suspended_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Account is suspended. New register sessions cannot be opened.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, opened_at
    INTO v_existing
  FROM public.pos_sessions
  WHERE tenant_id = v_scope.scope_tenant_id
    AND branch_id = v_scope.scope_branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Register is already open for this branch since %', v_existing.opened_at
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.pos_sessions (
    tenant_id,
    branch_id,
    opened_by,
    opening_cash,
    status
  ) VALUES (
    v_scope.scope_tenant_id,
    v_scope.scope_branch_id,
    v_user_id,
    ROUND(COALESCE(p_opening_cash, 0), 2),
    'open'
  )
  RETURNING id INTO v_session_id;

  RETURN public.get_register_session_summary(v_scope.scope_branch_id, v_session_id) -> 'session';
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Register is already open for this branch. Close the existing register before opening a new one.'
      USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.open_register_session(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_register_session(UUID, NUMERIC) TO authenticated;

COMMENT ON FUNCTION public.open_register_session(UUID, NUMERIC) IS
  'Opens one Register Session per branch, blocks duplicate open sessions, and blocks new sessions for manually suspended tenants.';

-- ============================================================
-- POS checkout suspension guard
-- ============================================================

CREATE OR REPLACE FUNCTION public.pos_checkout(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_customer RECORD;
  v_existing RECORD;
  v_product RECORD;
  v_item JSONB;
  v_line JSONB;
  v_payment JSONB;
  v_items JSONB := p_payload -> 'items';
  v_payments_json JSONB := p_payload -> 'payments';
  v_item_rows JSONB := '[]'::jsonb;
  v_existing_items JSONB := '[]'::jsonb;
  v_payment_rows JSONB := '[]'::jsonb;
  v_existing_payments JSONB := '[]'::jsonb;
  v_branch_id UUID;
  v_customer_id UUID;
  v_session_id UUID;
  v_product_id UUID;
  v_idempotency_key TEXT;
  v_payment_method TEXT;
  v_display_payment_method TEXT;
  v_note TEXT;
  v_invoice_id UUID := pg_catalog.gen_random_uuid();
  v_invoice_number TEXT;
  v_invoice_prefix TEXT;
  v_zatca_invoice_type public.invoice_type := 'simplified';
  v_qty NUMERIC(12, 3);
  v_amount_paid NUMERIC(12, 2);
  v_counter BIGINT;
  v_sort_order INT;
  v_vat_mode TEXT;
  v_vat_treatment TEXT;
  v_tax_category TEXT;
  v_rate_percent NUMERIC(5, 2);
  v_rate NUMERIC(8, 6);
  v_change_amount NUMERIC(12, 2) := 0;
  v_existing_amount_received NUMERIC(12, 2);
  v_existing_change_amount NUMERIC(12, 2);
  v_existing_payment_count INTEGER := 0;
  v_existing_cash_amount NUMERIC(12, 2) := 0;
  v_existing_card_amount NUMERIC(12, 2) := 0;
  v_line_amount NUMERIC(12, 4);
  v_line_subtotal NUMERIC(12, 2);
  v_line_tax NUMERIC(12, 2);
  v_line_total NUMERIC(12, 2);
  v_subtotal NUMERIC(12, 2) := 0;
  v_tax_amount NUMERIC(12, 2) := 0;
  v_total NUMERIC(12, 2) := 0;
  v_created_at TIMESTAMPTZ := NOW();
  v_is_split_payment BOOLEAN := FALSE;
  v_split_method TEXT;
  v_split_amount NUMERIC(12, 2);
  v_split_total NUMERIC(12, 2) := 0;
  v_split_cash_amount NUMERIC(12, 2) := 0;
  v_split_card_amount NUMERIC(12, 2) := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid checkout payload' USING ERRCODE = '22023';
  END IF;

  v_branch_id := NULLIF(TRIM(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;
  v_customer_id := NULLIF(TRIM(COALESCE(p_payload ->> 'customer_id', '')), '')::uuid;
  v_session_id := NULLIF(TRIM(COALESCE(p_payload ->> 'session_id', '')), '')::uuid;
  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  v_payment_method := COALESCE(NULLIF(TRIM(p_payload ->> 'payment_method'), ''), 'cash');
  v_note := NULLIF(TRIM(COALESCE(p_payload ->> 'note', '')), '');
  v_amount_paid := NULLIF(TRIM(COALESCE(p_payload ->> 'amount_paid', '')), '')::numeric;
  v_is_split_payment := v_payments_json IS NOT NULL;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
     OR length(v_idempotency_key) < 8
     OR length(v_idempotency_key) > 120
  THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  IF v_is_split_payment THEN
    IF jsonb_typeof(v_payments_json) <> 'array' OR jsonb_array_length(v_payments_json) <> 2 THEN
      RAISE EXCEPTION 'Split payment requires cash and card amounts' USING ERRCODE = '22023';
    END IF;

    v_payment_method := 'other';
    v_display_payment_method := 'split';
  ELSE
    IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
      RAISE EXCEPTION 'Unsupported payment method' USING ERRCODE = '22023';
    END IF;

    v_display_payment_method := v_payment_method;
  END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Checkout requires at least one item' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, name, invoice_prefix, vat_mode, is_active,
         COALESCE(allow_split_payments, FALSE) AS allow_split_payments
    INTO v_branch
  FROM public.branches
  WHERE id = v_branch_id;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_is_split_payment AND v_branch.allow_split_payments IS NOT TRUE THEN
    RAISE EXCEPTION 'Split Payment is not enabled for this branch' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent retries/double-clicks for the same branch/key so the
  -- second request returns the first invoice instead of racing the unique index.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch.id::text || ':' || v_idempotency_key, 0));

  SELECT id, invoice_number, created_at, subtotal, tax_amount, total_amount,
         payment_method, zatca_invoice_type, payment_status
    INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_branch_id
    AND checkout_idempotency_key = v_idempotency_key;

  IF FOUND THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'product_id', product_id,
          'name', name,
          'name_ar', name_ar,
          'unit', unit,
          'quantity', quantity,
          'unit_price', unit_price,
          'line_amount', round(unit_price * quantity, 2),
          'subtotal', subtotal,
          'tax_amount', tax_amount,
          'total', total
        )
        ORDER BY sort_order
      ),
      '[]'::jsonb
    )
      INTO v_existing_items
    FROM public.invoice_items
    WHERE invoice_id = v_existing.id;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'method', method::text,
          'amount', amount,
          'amount_received', amount_received,
          'change_amount', change_amount
        )
        ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST, id
      ),
      '[]'::jsonb
    )
      INTO v_existing_payments
    FROM public.payments
    WHERE invoice_id = v_existing.id;

    SELECT COUNT(*)::integer,
           COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN method = 'card' THEN amount ELSE 0 END), 0)
      INTO v_existing_payment_count, v_existing_cash_amount, v_existing_card_amount
    FROM public.payments
    WHERE invoice_id = v_existing.id;

    SELECT COALESCE(amount_received, amount, v_existing.total_amount),
           COALESCE(change_amount, 0)
      INTO v_existing_amount_received, v_existing_change_amount
    FROM public.payments
    WHERE invoice_id = v_existing.id
    ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      v_existing_amount_received := v_existing.total_amount;
      v_existing_change_amount := 0;
    END IF;

    v_display_payment_method := CASE
      WHEN v_existing_payment_count > 1
       AND v_existing_cash_amount > 0
       AND v_existing_card_amount > 0
        THEN 'split'
      ELSE COALESCE(v_existing.payment_method::text, 'cash')
    END;

    RETURN jsonb_build_object(
      'invoice_id', v_existing.id,
      'invoice_number', v_existing.invoice_number,
      'created_at', v_existing.created_at,
      'subtotal', v_existing.subtotal,
      'tax_amount', v_existing.tax_amount,
      'total', v_existing.total_amount,
      'payment_method', v_existing.payment_method,
      'display_payment_method', v_display_payment_method,
      'payment_status', v_existing.payment_status,
      'amount_received', v_existing_amount_received,
      'change_amount', v_existing_change_amount,
      'payments', v_existing_payments,
      'zatca_invoice_type', v_existing.zatca_invoice_type,
      'items', v_existing_items,
      'idempotent_replay', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = v_branch.tenant_id
      AND (
        COALESCE(t.is_active, TRUE) IS NOT TRUE
        OR t.suspended_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Account is suspended. Please contact the business owner or Kubri support.'
      USING ERRCODE = '42501';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT id, customer_type, vat_number, is_active
      INTO v_customer
    FROM public.customers
    WHERE id = v_customer_id
      AND tenant_id = v_branch.tenant_id
      AND branch_id = v_branch.id;

    IF NOT FOUND OR v_customer.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Customer not found or inactive' USING ERRCODE = '42501';
    END IF;

    IF v_customer.customer_type = 'business'
       AND COALESCE(v_customer.vat_number, '') ~ '^3[0-9]{13}3$'
    THEN
      v_zatca_invoice_type := 'standard';
    END IF;
  END IF;

  IF v_session_id IS NOT NULL THEN
    PERFORM 1
    FROM public.pos_sessions
    WHERE id = v_session_id
      AND tenant_id = v_branch.tenant_id
      AND branch_id = v_branch.id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'POS session is not open for this branch' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_vat_mode := CASE
    WHEN COALESCE(v_branch.vat_mode, 'exclusive') IN ('exclusive', 'inclusive')
      THEN COALESCE(v_branch.vat_mode, 'exclusive')
    ELSE 'exclusive'
  END;

  FOR v_item, v_sort_order IN
    SELECT value, (ordinality - 1)::int
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(value, ordinality)
  LOOP
    v_product_id := NULLIF(TRIM(COALESCE(v_item ->> 'product_id', '')), '')::uuid;
    v_qty := NULLIF(TRIM(COALESCE(v_item ->> 'quantity', '')), '')::numeric;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid checkout item' USING ERRCODE = '22023';
    END IF;

    SELECT id, tenant_id, branch_id, name, name_ar, sku, unit, price, tax_rate,
           tax_category, is_taxable, vat_treatment, is_service, stock_quantity,
           track_stock, is_active, is_available
      INTO v_product
    FROM public.products
    WHERE id = v_product_id
      AND tenant_id = v_branch.tenant_id
      AND branch_id = v_branch.id
    FOR UPDATE;

    IF NOT FOUND OR v_product.is_active IS NOT TRUE OR v_product.is_available IS NOT TRUE THEN
      RAISE EXCEPTION 'Product is not available for checkout' USING ERRCODE = '42501';
    END IF;

    v_vat_treatment := COALESCE(v_product.vat_treatment, 'inherit');
    IF v_vat_treatment = 'inherit' THEN
      v_vat_treatment := v_vat_mode;
    END IF;

    IF v_vat_treatment = 'exempt' OR v_product.is_taxable IS FALSE THEN
      v_rate_percent := 0;
      v_tax_category := COALESCE(NULLIF(v_product.tax_category, ''), 'O');
      v_vat_treatment := 'exempt';
    ELSE
      v_rate_percent := COALESCE(v_product.tax_rate, 15);
      v_tax_category := COALESCE(NULLIF(v_product.tax_category, ''), 'S');
    END IF;

    v_rate := v_rate_percent / 100;
    v_line_amount := COALESCE(v_product.price, 0) * v_qty;

    IF v_vat_treatment = 'inclusive' AND v_rate > 0 THEN
      v_line_total := round(v_line_amount, 2);
      v_line_subtotal := round(v_line_total / (1 + v_rate), 2);
      v_line_tax := v_line_total - v_line_subtotal;
    ELSIF v_vat_treatment = 'exclusive' AND v_rate > 0 THEN
      v_line_subtotal := round(v_line_amount, 2);
      v_line_tax := round(v_line_subtotal * v_rate, 2);
      v_line_total := v_line_subtotal + v_line_tax;
    ELSE
      v_line_subtotal := round(v_line_amount, 2);
      v_line_tax := 0;
      v_line_total := v_line_subtotal;
    END IF;

    IF COALESCE(v_product.track_stock, FALSE) IS TRUE
       AND COALESCE(v_product.is_service, FALSE) IS FALSE
    THEN
      UPDATE public.products
      SET stock_quantity = stock_quantity - v_qty
      WHERE id = v_product.id
        AND COALESCE(stock_quantity, 0) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_product.name
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total := v_total + v_line_total;

    v_item_rows := v_item_rows || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'name_ar', v_product.name_ar,
      'sku', v_product.sku,
      'unit', COALESCE(v_product.unit, 'pcs'),
      'quantity', v_qty,
      'unit_price', v_product.price,
      'line_amount', round(v_line_amount, 2),
      -- products.tax_rate is stored as a percentage, while invoice_items.tax_rate
      -- follows the existing ZATCA-facing convention of a decimal fraction.
      'tax_rate', v_rate,
      'tax_category', v_tax_category,
      'subtotal', v_line_subtotal,
      'tax_amount', v_line_tax,
      'total', v_line_total,
      'sort_order', v_sort_order,
      'track_stock', COALESCE(v_product.track_stock, FALSE)
    ));
  END LOOP;

  v_subtotal := round(v_subtotal, 2);
  v_tax_amount := round(v_tax_amount, 2);
  v_total := round(v_total, 2);

  IF v_is_split_payment THEN
    FOR v_payment IN
      SELECT value FROM jsonb_array_elements(v_payments_json) AS t(value)
    LOOP
      v_split_method := NULLIF(TRIM(COALESCE(v_payment ->> 'method', '')), '');
      v_split_amount := round(NULLIF(TRIM(COALESCE(v_payment ->> 'amount', '')), '')::numeric, 2);

      IF v_split_method NOT IN ('cash', 'card') THEN
        RAISE EXCEPTION 'Split Payment supports cash and card only' USING ERRCODE = '22023';
      END IF;

      IF v_split_amount IS NULL OR v_split_amount <= 0 THEN
        RAISE EXCEPTION 'Split Payment amounts must be greater than zero' USING ERRCODE = '22023';
      END IF;

      IF v_split_method = 'cash' THEN
        IF v_split_cash_amount > 0 THEN
          RAISE EXCEPTION 'Split Payment can include only one cash amount' USING ERRCODE = '22023';
        END IF;
        v_split_cash_amount := v_split_amount;
      ELSE
        IF v_split_card_amount > 0 THEN
          RAISE EXCEPTION 'Split Payment can include only one card amount' USING ERRCODE = '22023';
        END IF;
        v_split_card_amount := v_split_amount;
      END IF;

      v_split_total := v_split_total + v_split_amount;
    END LOOP;

    IF v_split_cash_amount <= 0 OR v_split_card_amount <= 0 THEN
      RAISE EXCEPTION 'Split Payment requires both cash and card amounts' USING ERRCODE = '22023';
    END IF;

    IF ABS(v_split_total - v_total) > 0.01 THEN
      RAISE EXCEPTION 'Split Payment amounts must equal invoice total' USING ERRCODE = '23514';
    END IF;

    v_payment_rows := jsonb_build_array(
      jsonb_build_object(
        'method', 'cash',
        'amount', v_split_cash_amount,
        'amount_received', v_split_cash_amount,
        'change_amount', 0
      ),
      jsonb_build_object(
        'method', 'card',
        'amount', v_split_card_amount,
        'amount_received', v_split_card_amount,
        'change_amount', 0
      )
    );
    v_amount_paid := v_total;
    v_change_amount := 0;
  ELSE
    IF v_amount_paid IS NULL OR v_payment_method IN ('card', 'bank_transfer') THEN
      v_amount_paid := v_total;
    END IF;

    IF v_payment_method = 'cash' AND COALESCE(v_amount_paid, 0) + 0.005 < v_total THEN
      RAISE EXCEPTION 'Amount paid is less than invoice total' USING ERRCODE = '23514';
    END IF;

    v_amount_paid := round(v_amount_paid, 2);
    v_change_amount := CASE
      WHEN v_payment_method = 'cash' THEN GREATEST(round(v_amount_paid - v_total, 2), 0)
      ELSE 0
    END;

    v_payment_rows := jsonb_build_array(jsonb_build_object(
      'method', v_payment_method,
      'amount', v_total,
      'amount_received', v_amount_paid,
      'change_amount', v_change_amount
    ));
  END IF;

  v_counter := public.get_next_invoice_counter(v_branch.id);
  v_invoice_prefix := COALESCE(NULLIF(TRIM(v_branch.invoice_prefix), ''), 'INV');
  v_invoice_number := v_invoice_prefix || '-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');

  INSERT INTO public.invoices (
    id,
    tenant_id,
    branch_id,
    customer_id,
    created_by,
    session_id,
    invoice_number,
    checkout_idempotency_key,
    zatca_invoice_type,
    zatca_type_code,
    zatca_status,
    subtotal,
    discount_amount,
    taxable_amount,
    tax_amount,
    total_amount,
    currency_code,
    invoice_date,
    payment_method,
    status,
    payment_status,
    notes,
    created_at
  ) VALUES (
    v_invoice_id,
    v_branch.tenant_id,
    v_branch.id,
    v_customer_id,
    v_user_id,
    v_session_id,
    v_invoice_number,
    v_idempotency_key,
    v_zatca_invoice_type,
    '388',
    'pending',
    v_subtotal,
    0,
    v_subtotal,
    v_tax_amount,
    v_total,
    'SAR',
    (v_created_at AT TIME ZONE 'Asia/Riyadh')::date,
    v_payment_method::public.payment_method,
    'posted',
    'paid',
    v_note,
    v_created_at
  );

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(v_item_rows) AS t(value)
  LOOP
    INSERT INTO public.invoice_items (
      invoice_id,
      tenant_id,
      product_id,
      name,
      name_ar,
      sku,
      unit,
      quantity,
      unit_price,
      discount_percent,
      discount_amount,
      subtotal,
      tax_rate,
      tax_category,
      tax_amount,
      total,
      sort_order
    ) VALUES (
      v_invoice_id,
      v_branch.tenant_id,
      (v_line ->> 'product_id')::uuid,
      v_line ->> 'name',
      v_line ->> 'name_ar',
      v_line ->> 'sku',
      v_line ->> 'unit',
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price')::numeric,
      0,
      0,
      (v_line ->> 'subtotal')::numeric,
      (v_line ->> 'tax_rate')::numeric,
      v_line ->> 'tax_category',
      (v_line ->> 'tax_amount')::numeric,
      (v_line ->> 'total')::numeric,
      (v_line ->> 'sort_order')::int
    );

    IF (v_line ->> 'track_stock')::boolean IS TRUE THEN
      INSERT INTO public.pos_stock_movements (
        tenant_id,
        branch_id,
        product_id,
        invoice_id,
        quantity_delta,
        reason,
        created_by
      ) VALUES (
        v_branch.tenant_id,
        v_branch.id,
        (v_line ->> 'product_id')::uuid,
        v_invoice_id,
        -((v_line ->> 'quantity')::numeric),
        'pos_sale',
        v_user_id
      );
    END IF;
  END LOOP;

  FOR v_payment IN
    SELECT value FROM jsonb_array_elements(v_payment_rows) AS t(value)
  LOOP
    INSERT INTO public.payments (
      tenant_id,
      invoice_id,
      recorded_by,
      amount,
      amount_received,
      change_amount,
      method,
      paid_at
    ) VALUES (
      v_branch.tenant_id,
      v_invoice_id,
      v_user_id,
      (v_payment ->> 'amount')::numeric,
      (v_payment ->> 'amount_received')::numeric,
      (v_payment ->> 'change_amount')::numeric,
      (v_payment ->> 'method')::public.payment_method,
      v_created_at
    );
  END LOOP;

  IF v_is_split_payment
     AND to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL
  THEN
    PERFORM public.record_audit_event(
      'pos_split_payment_checkout',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_profile.role,
      'invoice',
      v_invoice_id,
      'info',
      'succeeded',
      jsonb_build_object(
        'payment_count', 2,
        'cash_amount', v_split_cash_amount,
        'card_amount', v_split_card_amount,
        'invoice_total', v_total
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'created_at', v_created_at,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total', v_total,
    'payment_method', v_payment_method,
    'display_payment_method', v_display_payment_method,
    'payment_status', 'paid',
    'amount_received', v_amount_paid,
    'change_amount', v_change_amount,
    'payments', v_payment_rows,
    'zatca_invoice_type', v_zatca_invoice_type,
    'items', v_item_rows,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_checkout(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_checkout(JSONB) TO authenticated;

COMMENT ON FUNCTION public.pos_checkout(JSONB) IS
  'POS checkout RPC. Supports legacy single payment checkout and branch-enabled Split Payment; blocks new billing for manually suspended tenants. Does not call ZATCA.';

NOTIFY pgrst, 'reload schema';

COMMIT;
