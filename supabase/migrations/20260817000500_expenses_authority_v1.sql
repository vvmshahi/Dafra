BEGIN;

-- Actual expenses are posted costs. Recurring templates remain untouched and
-- continue to be estimates only. Existing expense rows are never rewritten.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS creation_idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS creation_request_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_create_idempotency_idx
  ON public.expenses (tenant_id, branch_id, added_by, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_expense_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_branch record;
  v_supplier record;
  v_existing record;
  v_branch_id uuid;
  v_category_id uuid;
  v_supplier_id uuid;
  v_operation_id uuid;
  v_expense_date date;
  v_amount numeric(12,2);
  v_expense_name text;
  v_vat_choice text;
  v_vat_mode text;
  v_payment_method text;
  v_expense_before_vat numeric(12,2);
  v_vat_amount numeric(12,2);
  v_total_paid numeric(12,2);
  v_fingerprint text;
  v_expense_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AUTHENTICATION_AND_EXPENSE_PAYLOAD_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payload) AS key
    WHERE key NOT IN (
      'branch_id', 'expense_date', 'description', 'amount', 'vat_treatment',
      'vat_amount_mode', 'payment_method', 'category_id', 'supplier_id',
      'vendor_name', 'tax_invoice_number', 'supplier_vat_number',
      'supplier_cr_number', 'supplier_contact', 'invoice_time', 'receipt_url',
      'notes', 'operation_id'
    )
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_EXPENSE_FIELD' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_category_id := NULLIF(btrim(p_payload ->> 'category_id'), '')::uuid;
    v_supplier_id := NULLIF(btrim(p_payload ->> 'supplier_id'), '')::uuid;
    v_operation_id := NULLIF(btrim(p_payload ->> 'operation_id'), '')::uuid;
    v_expense_date := NULLIF(btrim(p_payload ->> 'expense_date'), '')::date;
    v_amount := NULLIF(btrim(p_payload ->> 'amount'), '')::numeric(12,2);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_EXPENSE_VALUE' USING ERRCODE = '22023';
  END;

  v_expense_name := NULLIF(btrim(p_payload ->> 'description'), '');
  v_vat_choice := NULLIF(btrim(p_payload ->> 'vat_treatment'), '');
  v_vat_mode := NULLIF(btrim(p_payload ->> 'vat_amount_mode'), '');
  v_payment_method := NULLIF(btrim(p_payload ->> 'payment_method'), '');

  IF v_branch_id IS NULL OR v_operation_id IS NULL OR v_expense_date IS NULL
     OR v_expense_name IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'BRANCH_OPERATION_DATE_NAME_AND_POSITIVE_AMOUNT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_vat_choice NOT IN ('non_claimable', 'claimable') THEN
    RAISE EXCEPTION 'EXPLICIT_VAT_TREATMENT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'EXPLICIT_PAYMENT_METHOD_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF (v_vat_choice = 'claimable' AND v_vat_mode NOT IN ('inclusive', 'exclusive'))
     OR (v_vat_choice = 'non_claimable' AND v_vat_mode IS NOT NULL) THEN
    RAISE EXCEPTION 'EXPLICIT_VAT_AMOUNT_MODE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile FROM public.user_profiles WHERE id = v_user_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_branch_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE OR v_branch.is_active IS NOT TRUE
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_profile.role::text NOT IN ('owner', 'admin') AND v_profile.branch_id IS DISTINCT FROM v_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;

  IF v_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.expense_categories category
    WHERE category.id = v_category_id
      AND (category.tenant_id IS NULL OR category.tenant_id = v_branch.tenant_id)
  ) THEN
    RAISE EXCEPTION 'EXPENSE_CATEGORY_OUTSIDE_TENANT_SCOPE' USING ERRCODE = '42501';
  END IF;

  IF v_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_supplier_id;
    IF NOT FOUND OR v_supplier.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_supplier.branch_id IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'SUPPLIER_OUTSIDE_BRANCH_SCOPE' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- JSONB text is canonical by key order and intentionally excludes all
  -- browser-computed net/VAT/total values: the server always derives them.
  v_fingerprint := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch_id::text || ':' || v_user_id::text || ':' || v_operation_id::text, 0));
  SELECT id, creation_request_fingerprint, expense_before_vat, vat_amount, total_paid
    INTO v_existing
  FROM public.expenses
  WHERE tenant_id = v_branch.tenant_id
    AND branch_id = v_branch_id
    AND added_by = v_user_id
    AND creation_idempotency_key = v_operation_id;
  IF FOUND THEN
    IF v_existing.creation_request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'expense_id', v_existing.id, 'expense_before_vat', v_existing.expense_before_vat,
      'vat_amount', v_existing.vat_amount, 'total_paid', v_existing.total_paid, 'idempotent_replay', true
    );
  END IF;

  IF v_vat_choice = 'non_claimable' THEN
    v_expense_before_vat := round(v_amount, 2);
    v_vat_amount := 0;
    v_total_paid := round(v_amount, 2);
  ELSIF v_vat_mode = 'inclusive' THEN
    v_total_paid := round(v_amount, 2);
    v_vat_amount := round(v_total_paid * 15 / 115, 2);
    v_expense_before_vat := round(v_total_paid - v_vat_amount, 2);
  ELSE
    v_expense_before_vat := round(v_amount, 2);
    v_vat_amount := round(v_expense_before_vat * .15, 2);
    v_total_paid := round(v_expense_before_vat + v_vat_amount, 2);
  END IF;

  INSERT INTO public.expenses (
    tenant_id, branch_id, added_by, category_id, supplier_id, expense_date, description,
    vendor_name, amount, vat_treatment, vat_claim_status, expense_before_vat, vat_amount,
    total_paid, payment_method, tax_invoice_number, supplier_vat_number, supplier_cr_number,
    supplier_contact, invoice_time, receipt_url, notes, creation_idempotency_key, creation_request_fingerprint
  ) VALUES (
    v_branch.tenant_id, v_branch_id, v_user_id, v_category_id, v_supplier_id, v_expense_date, v_expense_name,
    NULLIF(btrim(p_payload ->> 'vendor_name'), ''), v_expense_before_vat,
    CASE WHEN v_vat_choice = 'claimable' AND v_vat_mode = 'exclusive' THEN 'on_top'
         WHEN v_vat_choice = 'claimable' THEN 'included' ELSE 'no_vat' END,
    CASE WHEN v_vat_choice = 'claimable' THEN 'claimable' ELSE 'not_claimable' END,
    v_expense_before_vat, v_vat_amount, v_total_paid, v_payment_method,
    NULLIF(btrim(p_payload ->> 'tax_invoice_number'), ''), NULLIF(btrim(p_payload ->> 'supplier_vat_number'), ''),
    NULLIF(btrim(p_payload ->> 'supplier_cr_number'), ''), NULLIF(btrim(p_payload ->> 'supplier_contact'), ''),
    NULLIF(btrim(p_payload ->> 'invoice_time'), '')::time, NULLIF(btrim(p_payload ->> 'receipt_url'), ''),
    NULLIF(btrim(p_payload ->> 'notes'), ''), v_operation_id, v_fingerprint
  ) RETURNING id INTO v_expense_id;

  RETURN jsonb_build_object(
    'ok', true, 'expense_id', v_expense_id, 'expense_before_vat', v_expense_before_vat,
    'vat_amount', v_vat_amount, 'total_paid', v_total_paid, 'idempotent_replay', false
  );
END
$function$;

ALTER FUNCTION public.create_expense_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_expense_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expense_v1(jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_expense_v1(jsonb) IS
  'Authenticated server-authoritative actual expense creation with explicit VAT/payment choices and replay protection. Recurring templates are excluded.';

-- A separate reporting contract prevents recurring templates from being
-- presented as posted costs. Existing report functions remain available for
-- backward compatibility; the V1 workspace consumes these explicit values.
CREATE OR REPLACE FUNCTION public.get_expense_report_summary_v1(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_scope record;
  v_month_count integer;
  v_actual numeric := 0;
  v_recurring numeric := 0;
  v_monthly_recurring numeric := 0;
  v_logs jsonb := '[]'::jsonb;
  v_categories jsonb := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'INVALID_REPORT_DATE_RANGE' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);
  SELECT count(*)::integer INTO v_month_count FROM generate_series(
    date_trunc('month', p_start_date)::date, date_trunc('month', p_end_date)::date, '1 month'::interval
  );
  SELECT coalesce(sum(e.total_paid), 0) INTO v_actual
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN p_start_date AND p_end_date;
  SELECT coalesce(sum(f.monthly_amount), 0) INTO v_monthly_recurring
  FROM public.fixed_expenses f
  WHERE f.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR f.branch_id = v_scope.scope_branch_id)
    AND f.is_active IS TRUE;
  v_recurring := v_monthly_recurring * greatest(v_month_count, 0);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'date', e.expense_date::text, 'description', e.description, 'category', coalesce(c.name, '—'),
    'amount', e.total_paid, 'method', e.payment_method
  ) ORDER BY e.expense_date DESC, e.created_at DESC), '[]'::jsonb)
  INTO v_logs
  FROM (
    SELECT * FROM public.reporting_expenses_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND expense_date BETWEEN p_start_date AND p_end_date
    ORDER BY expense_date DESC, created_at DESC LIMIT 200
  ) e LEFT JOIN public.expense_categories c ON c.id = e.category_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value, 'color', color) ORDER BY value DESC), '[]'::jsonb)
  INTO v_categories
  FROM (
    SELECT coalesce(c.name, 'Uncategorized') AS name, sum(e.total_paid) AS value, coalesce(c.color, '#6b7280') AS color
    FROM public.reporting_expenses_v e LEFT JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    GROUP BY coalesce(c.name, 'Uncategorized'), coalesce(c.color, '#6b7280')
  ) categories;
  RETURN jsonb_build_object(
    'actualExpenses', v_actual, 'recurringEstimatedCosts', v_recurring,
    'projectedTotalCost', v_actual + v_recurring, 'monthlyRecurringEstimate', v_monthly_recurring,
    'totalVariable', v_actual, 'totalFixed', v_recurring, 'grandTotal', v_actual + v_recurring,
    'monthlyFixed', v_monthly_recurring, 'catBars', v_categories, 'log', v_logs
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.get_profit_report_summary_v1(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_scope record;
  v_month_count integer;
  v_revenue numeric := 0;
  v_purchase_costs numeric := 0;
  v_actual_expenses numeric := 0;
  v_monthly_recurring numeric := 0;
  v_recurring_estimate numeric := 0;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'INVALID_REPORT_DATE_RANGE' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);
  SELECT count(*)::integer INTO v_month_count FROM generate_series(
    date_trunc('month', p_start_date)::date, date_trunc('month', p_end_date)::date, '1 month'::interval
  );
  SELECT coalesce(sum(signed_total_amount), 0) INTO v_revenue
  FROM public.reporting_invoice_documents_v i
  WHERE i.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
    AND i.invoice_date BETWEEN p_start_date AND p_end_date AND i.is_counted IS TRUE;
  SELECT coalesce(sum(subtotal), 0) INTO v_purchase_costs
  FROM public.reporting_counted_purchases_v p
  WHERE p.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
    AND p.purchase_date BETWEEN p_start_date AND p_end_date AND p.is_counted IS TRUE;
  SELECT coalesce(sum(profit_expense_amount), 0) INTO v_actual_expenses
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN p_start_date AND p_end_date;
  SELECT coalesce(sum(monthly_amount), 0) INTO v_monthly_recurring
  FROM public.fixed_expenses f
  WHERE f.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR f.branch_id = v_scope.scope_branch_id)
    AND f.is_active IS TRUE;
  v_recurring_estimate := v_monthly_recurring * greatest(v_month_count, 0);
  RETURN jsonb_build_object(
    'totalRevenue', v_revenue, 'totalCOGS', v_purchase_costs,
    'actualExpenses', v_actual_expenses, 'recurringEstimatedCosts', v_recurring_estimate,
    'actualNetProfit', v_revenue - v_purchase_costs - v_actual_expenses,
    'projectedNetProfit', v_revenue - v_purchase_costs - v_actual_expenses - v_recurring_estimate,
    'netProfit', v_revenue - v_purchase_costs - v_actual_expenses - v_recurring_estimate,
    'totalExpenses', v_actual_expenses + v_recurring_estimate,
    'reportLabel', 'Projected Profit Estimate'
  );
END
$function$;

ALTER FUNCTION public.get_expense_report_summary_v1(date, date, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_profit_report_summary_v1(date, date, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_expense_report_summary_v1(date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_profit_report_summary_v1(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expense_report_summary_v1(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profit_report_summary_v1(date, date, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
