-- Forward-only Generation Debit Note implementation.
-- Debit Notes are full-parent, financial-only adjustments: they increase
-- revenue/VAT and customer AR, but never change inventory or payments.

CREATE OR REPLACE FUNCTION public.create_generation_note_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile record;
  v_policy jsonb;
  v_parent record;
  v_existing record;
  v_line record;
  v_note_id uuid := gen_random_uuid();
  v_note_number text;
  v_kind text;
  v_reason text;
  v_key text;
  v_return_stock boolean := false;
  v_counter bigint;
  v_now timestamptz := clock_timestamp();
  v_payment_method text;
  v_account_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'FISCAL_POLICY_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;
  v_kind := NULLIF(btrim(p_payload ->> 'note_type'), '');
  v_reason := NULLIF(btrim(p_payload ->> 'reason'), '');
  v_key := NULLIF(btrim(p_payload ->> 'idempotency_key'), '');
  v_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, false);
  IF v_kind NOT IN ('credit_note', 'debit_note') OR v_reason IS NULL
     OR length(v_reason) < 3 OR length(v_reason) > 500
     OR v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 200
     OR COALESCE((p_payload ->> 'expected_policy_revision')::bigint, 0) < 1
     OR NULLIF(btrim(p_payload ->> 'branch_id'), '') IS NULL
     OR NULLIF(btrim(p_payload ->> 'parent_invoice_id'), '') IS NULL THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;

  SELECT id, tenant_id, branch_id, role::text AS role, is_active INTO v_profile
  FROM public.user_profiles WHERE id = v_user;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  v_policy := public.resolve_fiscal_policy((p_payload ->> 'branch_id')::uuid);
  IF v_policy ->> 'regime' <> 'generation' THEN
    RAISE EXCEPTION 'CROSS_REGIME_NOTE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  IF (v_policy ->> 'policyRevision')::bigint <> (p_payload ->> 'expected_policy_revision')::bigint THEN
    RAISE EXCEPTION 'FISCAL_POLICY_CHANGED' USING ERRCODE = '40001';
  END IF;

  SELECT i.* INTO v_parent
  FROM public.invoices i
  WHERE i.id = (p_payload ->> 'parent_invoice_id')::uuid
  FOR UPDATE;
  IF NOT FOUND OR v_parent.tenant_id IS DISTINCT FROM (v_policy ->> 'tenantId')::uuid
     OR v_parent.branch_id IS DISTINCT FROM (p_payload ->> 'branch_id')::uuid THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '42501';
  END IF;
  IF v_parent.fiscal_regime_at_issue = 'integration' THEN
    RAISE EXCEPTION 'CROSS_REGIME_NOTE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  IF v_parent.fiscal_regime_at_issue IS DISTINCT FROM 'generation'
     OR v_parent.fiscal_lifecycle_state IS DISTINCT FROM 'generation_issued'
     OR v_parent.status::text <> 'posted'
     OR v_parent.zatca_invoice_type::text NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '23514';
  END IF;
  IF v_kind = 'credit_note' AND EXISTS (
    SELECT 1 FROM public.invoices
    WHERE original_invoice_id = v_parent.id
      AND zatca_invoice_type = 'credit_note'
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'GENERATION_CREDIT_LIMIT_EXCEEDED' USING ERRCODE = '23514';
  END IF;
  IF v_kind = 'debit_note' AND EXISTS (
    SELECT 1 FROM public.invoices
    WHERE original_invoice_id = v_parent.id
      AND zatca_invoice_type = 'debit_note'
      AND status <> 'cancelled'
      AND credit_note_idempotency_key IS DISTINCT FROM v_key
  ) THEN
    RAISE EXCEPTION 'GENERATION_DEBIT_LIMIT_EXCEEDED' USING ERRCODE = '23514';
  END IF;

  SELECT id, invoice_number, created_at, total_amount, fiscal_lifecycle_state,
         fiscal_qr_payload, credit_reason, zatca_invoice_type
    INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_parent.branch_id AND credit_note_idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.original_invoice_id IS DISTINCT FROM v_parent.id
       OR v_existing.zatca_invoice_type::text IS DISTINCT FROM v_kind
       OR v_existing.credit_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number, 'idempotent_replay', true);
  END IF;

  INSERT INTO public.generation_note_counters_v1(branch_id) VALUES (v_parent.branch_id) ON CONFLICT DO NOTHING;
  UPDATE public.generation_note_counters_v1 SET next_number = next_number + 1
   WHERE branch_id = v_parent.branch_id RETURNING next_number - 1 INTO v_counter;
  SELECT COALESCE(NULLIF(btrim(b.invoice_prefix), ''), 'INV') INTO v_note_number FROM public.branches b WHERE b.id = v_parent.branch_id;
  v_note_number := v_note_number || CASE WHEN v_kind = 'credit_note' THEN '-CN-' ELSE '-DN-' END || lpad(v_counter::text, 6, '0');
  v_payment_method := COALESCE(v_parent.payment_method::text, 'cash');

  INSERT INTO public.invoices (
    id, tenant_id, branch_id, customer_id, created_by, invoice_number, invoice_reference,
    original_invoice_id, credit_reason, credit_note_idempotency_key, zatca_invoice_type,
    zatca_type_code, zatca_status, subtotal, discount_amount, taxable_amount, tax_amount,
    total_amount, currency_code, invoice_date, payment_method, status, payment_status,
    notes, fiscal_regime_at_issue, fiscal_policy_revision_at_issue, fiscal_policy_snapshot,
    fiscal_lifecycle_state, fiscal_artifact_stage, created_at
  ) VALUES (
    v_note_id, v_parent.tenant_id, v_parent.branch_id, v_parent.customer_id, v_user,
    v_note_number, v_parent.invoice_number, v_parent.id, v_reason, v_key, v_kind::public.invoice_type,
    CASE WHEN v_kind = 'credit_note' THEN '381' ELSE '383' END, 'pending',
    v_parent.subtotal, v_parent.discount_amount, v_parent.taxable_amount, v_parent.tax_amount,
    v_parent.total_amount, COALESCE(v_parent.currency_code, 'SAR'), (v_now AT TIME ZONE 'Asia/Riyadh')::date,
    v_payment_method::public.payment_method, 'posted', (CASE WHEN v_kind = 'credit_note' THEN 'refunded' ELSE 'pending' END)::public.payment_status,
    v_reason, 'generation', (v_policy ->> 'policyRevision')::bigint, v_policy,
    'not_submitted', 'none', v_now
  );

  -- Debit Notes increase a named customer's receivable. The unique source key
  -- makes this safe if the surrounding RPC is replayed after the note insert.
  -- Walk-in Debit Notes remain financial documents but have no AR account.
  IF v_kind = 'debit_note' AND v_parent.customer_id IS NOT NULL THEN
    v_account_id := public.ar_ensure_customer_account_v1(v_parent.customer_id);
    INSERT INTO public.customer_receivable_entries (
      tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
      source_kind, source_id, debit_amount, currency_code, effective_at, description, created_by
    ) VALUES (
      v_parent.tenant_id, v_parent.branch_id, v_account_id, v_parent.customer_id, 'debit_note',
      'debit_note', v_note_id, round(v_parent.total_amount, 2), COALESCE(v_parent.currency_code, 'SAR'),
      v_now, 'Debit note ' || v_note_number, v_user
    ) ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING;
  END IF;

  FOR v_line IN SELECT * FROM public.invoice_items WHERE invoice_id = v_parent.id ORDER BY sort_order, id LOOP
    INSERT INTO public.invoice_items (
      invoice_id, tenant_id, product_id, original_invoice_item_id, name, name_ar, description, sku,
      unit, quantity, unit_price, discount_percent, discount_amount, subtotal, tax_rate, tax_category,
      tax_amount, total, sort_order, line_source, stock_tracked_at_sale, service_item_at_sale
    ) VALUES (
      v_note_id, v_parent.tenant_id, v_line.product_id, v_line.id, v_line.name, v_line.name_ar,
      v_line.description, v_line.sku, v_line.unit, v_line.quantity, v_line.unit_price,
      v_line.discount_percent, v_line.discount_amount, v_line.subtotal, v_line.tax_rate, v_line.tax_category,
      v_line.tax_amount, v_line.total, v_line.sort_order, v_line.line_source,
      v_line.stock_tracked_at_sale, v_line.service_item_at_sale
    );
    IF v_kind = 'credit_note' AND v_return_stock AND v_line.product_id IS NOT NULL
       AND COALESCE(v_line.stock_tracked_at_sale, false) IS TRUE
       AND COALESCE(v_line.service_item_at_sale, false) IS FALSE THEN
      UPDATE public.products SET stock_quantity = COALESCE(stock_quantity, 0) + v_line.quantity
       WHERE id = v_line.product_id AND tenant_id = v_parent.tenant_id AND branch_id = v_parent.branch_id;
      INSERT INTO public.pos_stock_movements(tenant_id, branch_id, product_id, invoice_id, quantity_delta, reason, created_by)
      VALUES (v_parent.tenant_id, v_parent.branch_id, v_line.product_id, v_note_id, v_line.quantity, 'refund_return', v_user);
    END IF;
  END LOOP;

  IF v_kind = 'credit_note' THEN
    INSERT INTO public.payment_refunds(tenant_id, branch_id, original_invoice_id, credit_note_invoice_id, method, amount, reason, status, created_by, created_at)
    VALUES (v_parent.tenant_id, v_parent.branch_id, v_parent.id, v_note_id, v_payment_method::public.payment_method, v_parent.total_amount, v_reason, 'completed', v_user, v_now);
  END IF;
  RETURN jsonb_build_object('invoice_id', v_note_id, 'invoice_number', v_note_number, 'idempotent_replay', false);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.create_generation_note_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_generation_note_v1(jsonb) TO authenticated;

-- Active dashboard/session functions predate the debit_note enum value in
-- their document scopes. Keep their existing credit-negative/debit-positive
-- sign convention while admitting Debit Notes into revenue and VAT totals.
DO $$
DECLARE
  v_function record;
  v_definition text;
  v_updated text;
BEGIN
  FOR v_function IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'close_register_session',
        'get_branch_dashboard_recent_invoices',
        'get_dashboard_summary',
        'get_register_session_summary',
        'get_register_sessions_filtered',
        'get_customer_intelligence'
      )
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated := replace(
      v_definition,
      '''simplified'', ''standard'', ''credit_note''',
      '''simplified'', ''standard'', ''credit_note'', ''debit_note'''
    );
    IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
  END LOOP;
END;
$$;
