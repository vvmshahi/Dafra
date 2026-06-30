-- ============================================================
-- Phase 2C-1 Full credit note / refund MVP
-- Apply manually in Supabase SQL editor after Phase 2B.
-- ============================================================
--
-- This patch adds backend-controlled full credit note creation.
-- It does not call ZATCA, does not modify existing invoices, and does not
-- change production credentials or onboarding state.
--
-- Flow:
--   public.create_full_credit_note(p_payload jsonb)
--
-- Required payload:
--   original_invoice_id: UUID of a posted reported/cleared invoice
--   idempotency_key: client-generated key for double-click/retry safety
--   reason: required credit note reason
--
-- Optional payload:
--   refund_method: cash | card | bank_transfer | other
--   return_stock: true | false
--
-- Credit notes are stored in public.invoices as ZATCA documents with:
--   zatca_invoice_type = 'credit_note'
--   zatca_type_code    = '381'
--   original_invoice_id and invoice_reference pointing to the original invoice
--
-- The original reported invoice is not edited. Its credit status is derived
-- from linked credit note rows.

BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS original_invoice_id UUID REFERENCES public.invoices(id);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS credit_reason TEXT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS credit_note_idempotency_key TEXT;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS original_invoice_item_id UUID REFERENCES public.invoice_items(id);

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS credit_note_counter BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.original_invoice_id IS
  'For credit/debit notes, references the original invoice document being corrected.';

COMMENT ON COLUMN public.invoices.credit_reason IS
  'Human-readable reason for issuing a credit/debit note. Used in ZATCA credit note XML.';

COMMENT ON COLUMN public.invoices.credit_note_idempotency_key IS
  'Client-generated idempotency key for backend-controlled credit note creation.';

COMMENT ON COLUMN public.invoice_items.original_invoice_item_id IS
  'For credit/debit note lines, references the original invoice item being credited.';

COMMENT ON COLUMN public.branches.credit_note_counter IS
  'Thread-safe branch-local human credit note counter. ZATCA ICV remains zatca_counter_number.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_original_invoice_not_self'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_original_invoice_not_self
      CHECK (original_invoice_id IS NULL OR original_invoice_id <> id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_credit_note_reason_required'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_credit_note_reason_required
      CHECK (
        zatca_invoice_type <> 'credit_note'
        OR NULLIF(TRIM(COALESCE(credit_reason, '')), '') IS NOT NULL
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_credit_note_type_code'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_credit_note_type_code
      CHECK (zatca_invoice_type <> 'credit_note' OR zatca_type_code = '381') NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS invoices_original_invoice_idx
  ON public.invoices (original_invoice_id, created_at DESC)
  WHERE original_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_branch_credit_note_idempotency_key_idx
  ON public.invoices (branch_id, credit_note_idempotency_key)
  WHERE credit_note_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_original_full_credit_note_once_idx
  ON public.invoices (original_invoice_id)
  WHERE original_invoice_id IS NOT NULL
    AND zatca_invoice_type = 'credit_note'
    AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS invoice_items_original_invoice_item_idx
  ON public.invoice_items (original_invoice_item_id)
  WHERE original_invoice_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id                     UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id              UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  original_invoice_id    UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  credit_note_invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_id             UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  method                 public.payment_method NOT NULL DEFAULT 'cash',
  amount                 NUMERIC(12, 2) NOT NULL,
  reason                 TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'completed',
  created_by             UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_refunds_amount_positive CHECK (amount > 0),
  CONSTRAINT payment_refunds_status_check CHECK (status IN ('pending', 'completed', 'failed')),
  CONSTRAINT payment_refunds_distinct_documents CHECK (original_invoice_id <> credit_note_invoice_id)
);

CREATE INDEX IF NOT EXISTS payment_refunds_original_invoice_idx
  ON public.payment_refunds (original_invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_refunds_credit_note_invoice_idx
  ON public.payment_refunds (credit_note_invoice_id);

CREATE INDEX IF NOT EXISTS payment_refunds_branch_created_idx
  ON public.payment_refunds (branch_id, created_at DESC);

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_refunds FROM anon;
REVOKE ALL ON TABLE public.payment_refunds FROM authenticated;
GRANT SELECT ON TABLE public.payment_refunds TO authenticated;

DROP POLICY IF EXISTS "payment_refunds_authenticated_read" ON public.payment_refunds;

CREATE POLICY "payment_refunds_authenticated_read"
  ON public.payment_refunds
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_active IS TRUE
        AND (
          up.role::text IN ('owner', 'admin')
          AND up.tenant_id = payment_refunds.tenant_id
          OR up.role::text IN ('branch', 'manager', 'cashier', 'accountant')
          AND up.tenant_id = payment_refunds.tenant_id
          AND up.branch_id = payment_refunds.branch_id
        )
    )
  );

CREATE OR REPLACE FUNCTION public.get_next_credit_note_counter(p_branch_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter BIGINT;
BEGIN
  UPDATE public.branches
  SET credit_note_counter = COALESCE(credit_note_counter, 0) + 1
  WHERE id = p_branch_id
  RETURNING credit_note_counter INTO v_counter;

  IF v_counter IS NULL THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
  END IF;

  RETURN v_counter;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_full_credit_note(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_original RECORD;
  v_existing RECORD;
  v_line RECORD;
  v_branch_prefix TEXT;
  v_counter BIGINT;
  v_credit_note_id UUID := pg_catalog.gen_random_uuid();
  v_credit_note_number TEXT;
  v_original_invoice_id UUID;
  v_idempotency_key TEXT;
  v_reason TEXT;
  v_refund_method TEXT;
  v_payment_id UUID;
  v_payment_method TEXT;
  v_return_stock BOOLEAN := FALSE;
  v_created_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid credit note payload' USING ERRCODE = '22023';
  END IF;

  v_original_invoice_id := NULLIF(TRIM(COALESCE(p_payload ->> 'original_invoice_id', '')), '')::uuid;
  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  v_reason := NULLIF(TRIM(COALESCE(p_payload ->> 'reason', '')), '');
  v_refund_method := NULLIF(TRIM(COALESCE(p_payload ->> 'refund_method', '')), '');
  v_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, FALSE);

  IF v_original_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Missing original invoice' USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
     OR length(v_idempotency_key) < 8
     OR length(v_idempotency_key) > 120
  THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Credit note reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
         i.zatca_invoice_type::text AS zatca_invoice_type,
         i.zatca_status::text AS zatca_status,
         i.status::text AS status,
         i.payment_status::text AS payment_status,
         i.payment_method::text AS payment_method,
         i.subtotal, i.discount_amount, i.taxable_amount, i.tax_amount,
         i.total_amount, i.currency_code, b.invoice_prefix, b.is_active AS branch_is_active
    INTO v_original
  FROM public.invoices i
  JOIN public.branches b ON b.id = i.branch_id
  WHERE i.id = v_original_invoice_id
  FOR UPDATE OF i;

  IF NOT FOUND OR v_original.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Original invoice not found or branch inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_original.branch_id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_original.zatca_invoice_type NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'Only original invoices can be credited' USING ERRCODE = '22023';
  END IF;

  IF v_original.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted invoices can be credited' USING ERRCODE = '23514';
  END IF;

  IF v_original.zatca_status NOT IN ('reported', 'cleared') THEN
    RAISE EXCEPTION 'Only reported or cleared invoices can be credited' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_original.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Original invoice total must be greater than zero' USING ERRCODE = '23514';
  END IF;

  IF v_refund_method IS NULL THEN
    SELECT id, method::text
      INTO v_payment_id, v_payment_method
    FROM public.payments
    WHERE invoice_id = v_original.id
    ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST
    LIMIT 1;

    v_refund_method := COALESCE(v_payment_method, v_original.payment_method, 'cash');
  ELSE
    SELECT id, method::text
      INTO v_payment_id, v_payment_method
    FROM public.payments
    WHERE invoice_id = v_original.id
    ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_refund_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Unsupported refund method' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('full-credit-note:' || v_original.id::text, 0));

  SELECT id, invoice_number, created_at, total_amount, zatca_status, payment_status
    INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_original.branch_id
    AND credit_note_idempotency_key = v_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'credit_note_invoice_id', v_existing.id,
      'credit_note_invoice_number', v_existing.invoice_number,
      'created_at', v_existing.created_at,
      'total', v_existing.total_amount,
      'refund_status', 'completed',
      'zatca_status', v_existing.zatca_status,
      'idempotent_replay', true
    );
  END IF;

  SELECT id, invoice_number, created_at, total_amount, zatca_status, payment_status
    INTO v_existing
  FROM public.invoices
  WHERE original_invoice_id = v_original.id
    AND zatca_invoice_type = 'credit_note'
    AND status <> 'cancelled'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Invoice has already been fully credited' USING ERRCODE = '23514';
  END IF;

  v_counter := public.get_next_credit_note_counter(v_original.branch_id);
  v_branch_prefix := COALESCE(NULLIF(TRIM(v_original.invoice_prefix), ''), 'INV');
  v_credit_note_number := v_branch_prefix || '-CN-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');

  INSERT INTO public.invoices (
    id,
    tenant_id,
    branch_id,
    customer_id,
    created_by,
    invoice_number,
    invoice_reference,
    original_invoice_id,
    credit_reason,
    credit_note_idempotency_key,
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
    v_credit_note_id,
    v_original.tenant_id,
    v_original.branch_id,
    v_original.customer_id,
    v_user_id,
    v_credit_note_number,
    v_original.invoice_number,
    v_original.id,
    v_reason,
    v_idempotency_key,
    'credit_note',
    '381',
    'pending',
    v_original.subtotal,
    v_original.discount_amount,
    v_original.taxable_amount,
    v_original.tax_amount,
    v_original.total_amount,
    COALESCE(v_original.currency_code, 'SAR'),
    (v_created_at AT TIME ZONE 'Asia/Riyadh')::date,
    v_refund_method::public.payment_method,
    'posted',
    'refunded',
    v_reason,
    v_created_at
  );

  FOR v_line IN
    SELECT oi.*, p.track_stock, p.is_service
    FROM public.invoice_items oi
    LEFT JOIN public.products p
      ON p.id = oi.product_id
     AND p.tenant_id = v_original.tenant_id
     AND p.branch_id = v_original.branch_id
    WHERE oi.invoice_id = v_original.id
    ORDER BY oi.sort_order, oi.created_at, oi.id
  LOOP
    INSERT INTO public.invoice_items (
      invoice_id,
      tenant_id,
      product_id,
      original_invoice_item_id,
      name,
      name_ar,
      description,
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
      v_credit_note_id,
      v_original.tenant_id,
      v_line.product_id,
      v_line.id,
      v_line.name,
      v_line.name_ar,
      v_line.description,
      v_line.sku,
      v_line.unit,
      v_line.quantity,
      v_line.unit_price,
      v_line.discount_percent,
      v_line.discount_amount,
      v_line.subtotal,
      v_line.tax_rate,
      v_line.tax_category,
      v_line.tax_amount,
      v_line.total,
      v_line.sort_order
    );

    IF v_return_stock IS TRUE
       AND v_line.product_id IS NOT NULL
       AND COALESCE(v_line.track_stock, FALSE) IS TRUE
       AND COALESCE(v_line.is_service, FALSE) IS FALSE
    THEN
      UPDATE public.products
      SET stock_quantity = COALESCE(stock_quantity, 0) + v_line.quantity
      WHERE id = v_line.product_id
        AND tenant_id = v_original.tenant_id
        AND branch_id = v_original.branch_id;

      INSERT INTO public.pos_stock_movements (
        tenant_id,
        branch_id,
        product_id,
        invoice_id,
        quantity_delta,
        reason,
        created_by
      ) VALUES (
        v_original.tenant_id,
        v_original.branch_id,
        v_line.product_id,
        v_credit_note_id,
        v_line.quantity,
        'refund_return',
        v_user_id
      );
    END IF;
  END LOOP;

  INSERT INTO public.payment_refunds (
    tenant_id,
    branch_id,
    original_invoice_id,
    credit_note_invoice_id,
    payment_id,
    method,
    amount,
    reason,
    status,
    created_by,
    created_at
  ) VALUES (
    v_original.tenant_id,
    v_original.branch_id,
    v_original.id,
    v_credit_note_id,
    v_payment_id,
    v_refund_method::public.payment_method,
    v_original.total_amount,
    v_reason,
    'completed',
    v_user_id,
    v_created_at
  );

  RETURN jsonb_build_object(
    'credit_note_invoice_id', v_credit_note_id,
    'credit_note_invoice_number', v_credit_note_number,
    'created_at', v_created_at,
    'total', v_original.total_amount,
    'refund_status', 'completed',
    'zatca_status', 'pending',
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_credit_note_counter(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_full_credit_note(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_full_credit_note(jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_full_credit_note(jsonb) IS
  'Creates a full credit note/refund document for a posted reported or cleared invoice. Backend-controlled, idempotent, tenant/branch scoped.';

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm new credit note linkage columns exist:
--
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (
--     table_name = 'invoices'
--     AND column_name IN ('original_invoice_id', 'credit_reason', 'credit_note_idempotency_key')
--     OR table_name = 'invoice_items'
--     AND column_name = 'original_invoice_item_id'
--     OR table_name = 'branches'
--     AND column_name = 'credit_note_counter'
--   )
-- ORDER BY table_name, column_name;
--
-- 2) Confirm refund table and RLS:
--
-- SELECT to_regclass('public.payment_refunds') AS payment_refunds_table;
--
-- SELECT policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = 'payment_refunds';
--
-- 3) Confirm RPC is executable by authenticated users:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.create_full_credit_note(jsonb)',
--   'EXECUTE'
-- ) AS authenticated_can_execute;
--
-- 4) Dry auth probe from an authenticated SQL session should fail cleanly
--    without creating data because payload is incomplete:
--
-- SELECT public.create_full_credit_note('{}'::jsonb);
