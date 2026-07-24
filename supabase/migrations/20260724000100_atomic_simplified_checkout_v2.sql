-- Atomic simplified checkout v2
-- Disabled by default. Additive. Does not classify, enqueue, or mutate any
-- historical invoice.

BEGIN;

ALTER TABLE public.zatca_finalization_runtime
  ADD COLUMN IF NOT EXISTS atomic_simplified_checkout_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.zatca_atomic_checkout_branch_gates_v2 (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, branch_id)
);

ALTER TABLE public.zatca_atomic_checkout_branch_gates_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_atomic_checkout_branch_gates_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_atomic_checkout_branch_gates_v2 TO service_role;

CREATE TABLE IF NOT EXISTS public.zatca_atomic_checkout_intents_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('invoice', 'credit_note')),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 120),
  cart_fingerprint text NOT NULL CHECK (cart_fingerprint ~ '^[a-f0-9]{64}$'),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  invoice_id uuid NOT NULL,
  invoice_uuid uuid NOT NULL,
  document_counter bigint NOT NULL CHECK (document_counter > 0),
  invoice_number text NOT NULL CHECK (NULLIF(btrim(invoice_number), '') IS NOT NULL),
  zatca_counter_number bigint NOT NULL CHECK (zatca_counter_number > 0),
  previous_hash text NOT NULL CHECK (NULLIF(btrim(previous_hash), '') IS NOT NULL),
  issue_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'prepared'
    CHECK (state IN ('prepared', 'committed', 'expired', 'failed')),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  prepared_snapshot jsonb,
  prepared_snapshot_hash text,
  signing_lease_token uuid,
  signing_lease_expires_at timestamptz,
  candidate_signed_xml text,
  candidate_xml_hash text,
  candidate_signature text,
  candidate_qr text,
  artifact_signed_at timestamptz,
  receipt_payload jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  committed_at timestamptz,
  UNIQUE (branch_id, idempotency_key),
  UNIQUE (invoice_id),
  UNIQUE (invoice_uuid),
  UNIQUE (branch_id, invoice_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS zatca_atomic_checkout_one_active_branch_v2
ON public.zatca_atomic_checkout_intents_v2(tenant_id, branch_id)
WHERE state = 'prepared';

CREATE UNIQUE INDEX IF NOT EXISTS zatca_atomic_checkout_chain_position_v2
ON public.zatca_atomic_checkout_intents_v2(tenant_id, branch_id, zatca_counter_number)
WHERE state IN ('prepared', 'committed');

CREATE INDEX IF NOT EXISTS zatca_atomic_checkout_expiry_v2
ON public.zatca_atomic_checkout_intents_v2(state, expires_at)
WHERE state = 'prepared';

ALTER TABLE public.zatca_atomic_checkout_intents_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_atomic_checkout_intents_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_atomic_checkout_intents_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.assert_zatca_atomic_checkout_intent_immutable_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.cart_fingerprint IS DISTINCT FROM OLD.cart_fingerprint
     OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.invoice_uuid IS DISTINCT FROM OLD.invoice_uuid
     OR NEW.document_counter IS DISTINCT FROM OLD.document_counter
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
     OR NEW.previous_hash IS DISTINCT FROM OLD.previous_hash
     OR NEW.issue_at IS DISTINCT FROM OLD.issue_at
     OR NEW.claim_token IS DISTINCT FROM OLD.claim_token
     OR (
       OLD.prepared_snapshot IS NOT NULL
       AND (
         NEW.prepared_snapshot IS DISTINCT FROM OLD.prepared_snapshot
         OR NEW.prepared_snapshot_hash IS DISTINCT FROM OLD.prepared_snapshot_hash
       )
     )
     OR (
       OLD.candidate_signed_xml IS NOT NULL
       AND (
         NEW.candidate_signed_xml IS DISTINCT FROM OLD.candidate_signed_xml
         OR NEW.candidate_xml_hash IS DISTINCT FROM OLD.candidate_xml_hash
         OR NEW.candidate_signature IS DISTINCT FROM OLD.candidate_signature
         OR NEW.candidate_qr IS DISTINCT FROM OLD.candidate_qr
       )
     )
     OR (
       OLD.receipt_payload IS NOT NULL
       AND NEW.receipt_payload IS DISTINCT FROM OLD.receipt_payload
     )
  THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_INTENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS zatca_atomic_checkout_intent_immutable_v2
ON public.zatca_atomic_checkout_intents_v2;
CREATE TRIGGER zatca_atomic_checkout_intent_immutable_v2
BEFORE UPDATE ON public.zatca_atomic_checkout_intents_v2
FOR EACH ROW EXECUTE FUNCTION public.assert_zatca_atomic_checkout_intent_immutable_v2();

-- The authoritative commercial functions historically generate their document
-- IDs into local PL/pgSQL variables and then reuse those variables for child
-- rows. A BEFORE INSERT trigger alone cannot replace that local identity:
-- invoice_items/payments would still reference the discarded generated ID.
--
-- Patch only the reviewed compatibility-aligned definitions, and only so a
-- private atomic transaction context can supply the reserved ID. Calls without
-- that context retain the original pg_catalog.gen_random_uuid() behavior.
DO $install_atomic_commercial_id_context$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_expected_hash text;
  v_expected_post_hash text;
  v_original text;
  v_replacement text;
BEGIN
  FOR
    v_signature,
    v_expected_hash,
    v_expected_post_hash,
    v_original,
    v_replacement
  IN
    SELECT *
    FROM (VALUES
      (
        'public.pos_checkout(jsonb)'::regprocedure,
        '68d6d28ff7ed53ad8b79180b3e26592b',
        '447dc2f026ae6f488fa434079759b75e',
        'v_invoice_id UUID := pg_catalog.gen_random_uuid();',
        $replacement$v_invoice_id UUID := COALESCE(
    NULLIF(current_setting('app.atomic_checkout_invoice_id', true), '')::uuid,
    pg_catalog.gen_random_uuid()
  );$replacement$
      ),
      (
        'public.create_partial_credit_note(jsonb)'::regprocedure,
        'ea38d6800970cf51594e27c11c376ebd',
        'acbf207e42d0a41cb81f09e9859e8fb1',
        'v_credit_note_id UUID := pg_catalog.gen_random_uuid();',
        $replacement$v_credit_note_id UUID := COALESCE(
    NULLIF(current_setting('app.atomic_checkout_invoice_id', true), '')::uuid,
    pg_catalog.gen_random_uuid()
  );$replacement$
      )
    ) reviewed(
      signature,
      expected_hash,
      expected_post_hash,
      original_text,
      replacement_text
    )
  LOOP
    v_definition := pg_get_functiondef(v_signature);
    IF v_definition LIKE '%app.atomic_checkout_invoice_id%' THEN
      IF md5(v_definition) IS DISTINCT FROM v_expected_post_hash THEN
        RAISE EXCEPTION 'ATOMIC_COMMERCIAL_PATCHED_FUNCTION_HASH_DRIFT:%', v_signature;
      END IF;
      CONTINUE;
    END IF;
    IF md5(v_definition) IS DISTINCT FROM v_expected_hash THEN
      RAISE EXCEPTION 'ATOMIC_COMMERCIAL_FUNCTION_HASH_DRIFT:%', v_signature;
    END IF;
    IF strpos(v_definition, v_original) = 0 THEN
      RAISE EXCEPTION 'ATOMIC_COMMERCIAL_ID_DECLARATION_MISSING:%', v_signature;
    END IF;
    EXECUTE replace(v_definition, v_original, v_replacement);
    IF md5(pg_get_functiondef(v_signature)) IS DISTINCT FROM v_expected_post_hash THEN
      RAISE EXCEPTION 'ATOMIC_COMMERCIAL_POST_HASH_MISMATCH:%', v_signature;
    END IF;
  END LOOP;
END
$install_atomic_commercial_id_context$;

-- Reserve an ordinary invoice/credit-note number in preparation. Calls made
-- by the commercial RPC during final commit reuse that reserved number and do
-- not advance the branch counter a second time.
CREATE OR REPLACE FUNCTION public.get_next_invoice_counter(p_branch_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_counter bigint;
  v_intent_id uuid;
  v_claim_token uuid;
BEGIN
  v_intent_id := NULLIF(current_setting('app.atomic_checkout_intent_id', true), '')::uuid;
  v_claim_token := NULLIF(current_setting('app.atomic_checkout_claim_token', true), '')::uuid;
  IF v_intent_id IS NOT NULL THEN
    SELECT document_counter INTO v_counter
    FROM public.zatca_atomic_checkout_intents_v2
    WHERE id = v_intent_id
      AND claim_token = v_claim_token
      AND branch_id = p_branch_id
      AND document_type = 'invoice'
      AND state = 'prepared'
      AND expires_at > clock_timestamp();
    IF v_counter IS NULL THEN RAISE EXCEPTION 'ATOMIC_CHECKOUT_COUNTER_CONTEXT_INVALID'; END IF;
    RETURN v_counter;
  END IF;

  UPDATE public.branches
  SET invoice_counter = invoice_counter + 1
  WHERE id = p_branch_id
  RETURNING invoice_counter INTO v_counter;
  IF v_counter IS NULL THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;
  RETURN v_counter;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_next_credit_note_counter(p_branch_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_counter bigint;
  v_intent_id uuid;
  v_claim_token uuid;
BEGIN
  v_intent_id := NULLIF(current_setting('app.atomic_checkout_intent_id', true), '')::uuid;
  v_claim_token := NULLIF(current_setting('app.atomic_checkout_claim_token', true), '')::uuid;
  IF v_intent_id IS NOT NULL THEN
    SELECT document_counter INTO v_counter
    FROM public.zatca_atomic_checkout_intents_v2
    WHERE id = v_intent_id
      AND claim_token = v_claim_token
      AND branch_id = p_branch_id
      AND document_type = 'credit_note'
      AND state = 'prepared'
      AND expires_at > clock_timestamp();
    IF v_counter IS NULL THEN RAISE EXCEPTION 'ATOMIC_CHECKOUT_COUNTER_CONTEXT_INVALID'; END IF;
    RETURN v_counter;
  END IF;

  UPDATE public.branches
  SET credit_note_counter = COALESCE(credit_note_counter, 0) + 1
  WHERE id = p_branch_id
  RETURNING credit_note_counter INTO v_counter;
  IF v_counter IS NULL THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;
  RETURN v_counter;
END
$function$;

-- The commercial RPCs remain authoritative. This trigger only supplies the
-- identity that the protected preparation phase already reserved.
CREATE OR REPLACE FUNCTION public.apply_zatca_atomic_checkout_identity_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.zatca_atomic_checkout_intents_v2%ROWTYPE;
  v_intent_id uuid;
  v_claim_token uuid;
BEGIN
  v_intent_id := NULLIF(current_setting('app.atomic_checkout_intent_id', true), '')::uuid;
  IF v_intent_id IS NULL THEN RETURN NEW; END IF;
  v_claim_token := NULLIF(current_setting('app.atomic_checkout_claim_token', true), '')::uuid;

  SELECT * INTO v_intent
  FROM public.zatca_atomic_checkout_intents_v2
  WHERE id = v_intent_id
    AND claim_token = v_claim_token
    AND actor_user_id = auth.uid()
    AND branch_id = NEW.branch_id
    AND state = 'prepared'
    AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'ATOMIC_CHECKOUT_IDENTITY_CONTEXT_INVALID'; END IF;

  IF v_intent.document_type = 'invoice' THEN
    IF NEW.checkout_idempotency_key IS DISTINCT FROM v_intent.idempotency_key
       OR NEW.zatca_invoice_type IS DISTINCT FROM 'simplified' THEN
      RAISE EXCEPTION 'ATOMIC_CHECKOUT_DOCUMENT_MISMATCH';
    END IF;
  ELSE
    IF NEW.credit_note_idempotency_key IS DISTINCT FROM v_intent.idempotency_key
       OR NEW.zatca_invoice_type IS DISTINCT FROM 'credit_note'
       OR NEW.original_invoice_id IS DISTINCT FROM
         NULLIF(v_intent.request_payload->>'original_invoice_id', '')::uuid THEN
      RAISE EXCEPTION 'ATOMIC_CHECKOUT_DOCUMENT_MISMATCH';
    END IF;
  END IF;

  NEW.id := v_intent.invoice_id;
  NEW.invoice_number := v_intent.invoice_number;
  NEW.zatca_uuid := v_intent.invoice_uuid;
  NEW.created_at := v_intent.issue_at;
  NEW.invoice_date := (v_intent.issue_at AT TIME ZONE 'Asia/Riyadh')::date;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS zatca_v2_05_apply_atomic_checkout_identity ON public.invoices;
CREATE TRIGGER zatca_v2_05_apply_atomic_checkout_identity
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.apply_zatca_atomic_checkout_identity_v2();

-- Existing invoice-based chain allocation must wait behind a prepared atomic
-- intent, otherwise a standard document could overtake its reserved PIH.
CREATE OR REPLACE FUNCTION public.prevent_zatca_chain_intent_overtake_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.state = 'allocated' AND EXISTS (
    SELECT 1
    FROM public.zatca_atomic_checkout_intents_v2 intent
    WHERE intent.tenant_id = NEW.tenant_id
      AND intent.branch_id = NEW.branch_id
      AND intent.state = 'prepared'
      AND intent.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'CHAIN_PREDECESSOR_PENDING:ATOMIC_CHECKOUT_INTENT';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS zatca_chain_intent_no_overtake_v2
ON public.zatca_chain_reservations_v2;
CREATE TRIGGER zatca_chain_intent_no_overtake_v2
BEFORE INSERT OR UPDATE OF state ON public.zatca_chain_reservations_v2
FOR EACH ROW EXECUTE FUNCTION public.prevent_zatca_chain_intent_overtake_v2();

CREATE OR REPLACE FUNCTION public.build_zatca_atomic_receipt_snapshot_v2(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'invoice_id', i.id,
    'invoice_number', i.invoice_number,
    'created_at', i.created_at,
    'subtotal', i.subtotal,
    'discount_amount', i.discount_amount,
    'taxable_amount', i.taxable_amount,
    'tax_amount', i.tax_amount,
    'total', i.total_amount,
    'currency_code', i.currency_code,
    'payment_method', i.payment_method::text,
    'payment_status', i.payment_status::text,
    'zatca_invoice_type', i.zatca_invoice_type::text,
    'zatca_type_code', i.zatca_type_code,
    'original_invoice_id', i.original_invoice_id,
    'invoice_reference', i.invoice_reference,
    'credit_reason', i.credit_reason,
    'document_language', i.document_language,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', ii.product_id,
        'original_invoice_item_id', ii.original_invoice_item_id,
        'name', ii.name,
        'name_ar', ii.name_ar,
        'sku', ii.sku,
        'unit', ii.unit,
        'quantity', ii.quantity,
        'unit_price', ii.unit_price,
        'discount_percent', ii.discount_percent,
        'discount_amount', ii.discount_amount,
        'subtotal', ii.subtotal,
        'tax_rate', ii.tax_rate,
        'tax_category', ii.tax_category,
        'tax_amount', ii.tax_amount,
        'total', ii.total,
        'sort_order', ii.sort_order
      ) ORDER BY ii.sort_order, ii.id)
      FROM public.invoice_items ii WHERE ii.invoice_id = i.id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'method', p.method::text,
        'amount', p.amount,
        'amount_received', p.amount_received,
        'change_amount', p.change_amount
      ) ORDER BY
        p.method::text,
        p.amount,
        COALESCE(p.amount_received, p.amount),
        COALESCE(p.change_amount, 0))
      FROM public.payments p WHERE p.invoice_id = i.id
    ), '[]'::jsonb),
    'seller', jsonb_build_object(
      'tenant_name', t.name,
      'tenant_name_ar', t.name_ar,
      'branch_id', b.id,
      'branch_name', b.name,
      'branch_name_ar', b.name_ar,
      'business_name', b.business_name,
      'business_name_ar', b.business_name_ar,
      'display_name', b.display_name,
      'vat_number', b.vat_number,
      'cr_number', b.cr_number,
      'building_number', b.building_number,
      'street', b.street,
      'street_ar', b.street_ar,
      'district', b.district,
      'district_ar', b.district_ar,
      'city', b.city,
      'city_ar', b.city_ar,
      'postal_code', b.postal_code,
      'country', b.country,
      'phone', b.phone,
      'website', b.website,
      'email', b.email,
      'logo_url', b.logo_url,
      'receipt_footer', b.receipt_footer,
      'show_footer', b.show_footer,
      'show_cash_change', b.show_cash_change,
      'show_logo', b.show_logo,
      'show_website', b.show_website,
      'show_email', b.show_email,
      'invoice_language', b.invoice_language,
      'presentation_settings', b.presentation_settings
    ),
    'customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'name_ar', c.name_ar,
      'customer_type', c.customer_type,
      'vat_number', c.vat_number,
      'cr_number', c.cr_number,
      'address', c.address,
      'address_ar', c.address_ar,
      'business_name', c.business_name,
      'business_name_ar', c.business_name_ar,
      'phone', c.phone
    ) END
  )
  FROM public.invoices i
  JOIN public.branches b ON b.id = i.branch_id
  JOIN public.tenants t ON t.id = i.tenant_id
  LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id
$function$;

CREATE OR REPLACE FUNCTION public.expire_zatca_atomic_checkout_intents_v2(
  p_limit integer DEFAULT 100
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION 'INVALID_CLEANUP_LIMIT'; END IF;
  WITH expired AS (
    SELECT id
    FROM public.zatca_atomic_checkout_intents_v2
    WHERE state = 'prepared' AND expires_at <= clock_timestamp()
    ORDER BY expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.zatca_atomic_checkout_intents_v2 intent
  SET state = 'expired',
      failure_code = COALESCE(failure_code, 'PREPARATION_INTENT_EXPIRED'),
      updated_at = clock_timestamp()
  FROM expired
  WHERE intent.id = expired.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.prepare_zatca_atomic_checkout_v2(
  p_actor_user_id uuid,
  p_document_type text,
  p_payload jsonb,
  p_cart_fingerprint text,
  p_ttl_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_gate jsonb;
  v_chain_head public.zatca_chain_heads_v2%ROWTYPE;
  v_existing public.zatca_atomic_checkout_intents_v2%ROWTYPE;
  v_intent public.zatca_atomic_checkout_intents_v2%ROWTYPE;
  v_original public.invoices%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_branch_id uuid;
  v_customer_id uuid;
  v_original_id uuid;
  v_idempotency_key text;
  v_document_counter bigint;
  v_prefix text;
  v_snapshot jsonb;
  v_snapshot_hash text;
  v_preview jsonb;
BEGIN
  IF p_document_type IS NULL
     OR p_document_type NOT IN ('invoice', 'credit_note')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_cart_fingerprint IS NULL
     OR p_cart_fingerprint !~ '^[a-f0-9]{64}$'
     OR p_ttl_seconds IS NULL
     OR p_ttl_seconds < 30 OR p_ttl_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_ATOMIC_CHECKOUT_PREPARATION';
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE id = p_actor_user_id AND is_active = true;
  IF NOT FOUND OR v_profile.role::text NOT IN ('owner', 'branch') THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_CALLER_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_idempotency_key := NULLIF(btrim(p_payload->>'idempotency_key'), '');
  IF v_idempotency_key IS NULL OR length(v_idempotency_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY';
  END IF;

  IF p_document_type = 'invoice' THEN
    v_branch_id := NULLIF(btrim(p_payload->>'branch_id'), '')::uuid;
  ELSE
    v_original_id := NULLIF(btrim(p_payload->>'original_invoice_id'), '')::uuid;
    SELECT * INTO v_original FROM public.invoices WHERE id = v_original_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORIGINAL_INVOICE_NOT_FOUND'; END IF;
    v_branch_id := v_original.branch_id;
    IF v_original.zatca_document_kind IS DISTINCT FROM 'simplified'
       OR v_original.zatca_status IS DISTINCT FROM 'reported' THEN
      RAISE EXCEPTION 'ATOMIC_CREDIT_NOTE_REQUIRES_REPORTED_SIMPLIFIED_ORIGINAL';
    END IF;
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_branch_id AND is_active = true;
  IF NOT FOUND OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_profile.role::text = 'branch' AND v_profile.branch_id IS DISTINCT FROM v_branch.id) THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_document_type = 'invoice' THEN
    v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
    IF v_customer_id IS NOT NULL THEN
      SELECT * INTO v_customer
      FROM public.customers
      WHERE id = v_customer_id
        AND tenant_id = v_branch.tenant_id
        AND branch_id = v_branch.id
        AND is_active = true;
      IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
      IF v_customer.customer_type = 'business'
         AND COALESCE(v_customer.vat_number, '') ~ '^3[0-9]{13}3$' THEN
        RAISE EXCEPTION 'STANDARD_DOCUMENT_REQUIRES_CLEARANCE_FLOW';
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_runtime FROM public.zatca_finalization_runtime WHERE singleton = true;
  v_gate := public.get_zatca_branch_readiness_v2(v_branch.id, p_actor_user_id);
  IF NOT COALESCE(v_runtime.immutable_finalization_enabled, false)
     OR NOT COALESCE(v_runtime.simplified_enabled, false)
     OR NOT COALESCE(v_runtime.atomic_simplified_checkout_enabled, false)
     OR NOT COALESCE((v_gate->>'structurallyReady')::boolean, false)
     OR NOT COALESCE((v_gate->>'clientAcknowledged')::boolean, false)
     OR NOT EXISTS (
       SELECT 1 FROM public.zatca_atomic_checkout_branch_gates_v2 g
       WHERE g.tenant_id = v_branch.tenant_id
         AND g.branch_id = v_branch.id
         AND g.enabled = true
     ) THEN
    RAISE EXCEPTION 'ATOMIC_SIMPLIFIED_CHECKOUT_NOT_READY';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_branch.id::text || ':' || v_idempotency_key, 0
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_branch.tenant_id::text || ':' || v_branch.id::text, 0
  ));

  UPDATE public.zatca_atomic_checkout_intents_v2
  SET state = 'expired',
      failure_code = COALESCE(failure_code, 'PREPARATION_INTENT_EXPIRED'),
      updated_at = clock_timestamp()
  WHERE tenant_id = v_branch.tenant_id
    AND branch_id = v_branch.id
    AND state = 'prepared'
    AND expires_at <= clock_timestamp();

  SELECT * INTO v_existing
  FROM public.zatca_atomic_checkout_intents_v2
  WHERE branch_id = v_branch.id AND idempotency_key = v_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.cart_fingerprint IS DISTINCT FROM p_cart_fingerprint
       OR v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_existing.document_type IS DISTINCT FROM p_document_type THEN
      RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH';
    END IF;
    IF v_existing.state = 'committed' THEN
      RETURN jsonb_build_object(
        'status', 'committed',
        'intentId', v_existing.id,
        'invoiceId', v_existing.invoice_id,
        'receipt', v_existing.receipt_payload,
        'idempotentReplay', true
      );
    END IF;
    IF v_existing.state = 'prepared' AND v_existing.expires_at > clock_timestamp() THEN
      RETURN jsonb_build_object(
        'status', 'prepared',
        'intentId', v_existing.id,
        'claimToken', v_existing.claim_token,
        'snapshot', v_existing.prepared_snapshot,
        'snapshotHash', v_existing.prepared_snapshot_hash,
        'artifactReady', v_existing.candidate_signed_xml IS NOT NULL,
        'idempotentReplay', true
      );
    END IF;
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_INTENT_TERMINAL:%', v_existing.state;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.zatca_atomic_checkout_intents_v2 intent
    WHERE intent.tenant_id = v_branch.tenant_id
      AND intent.branch_id = v_branch.id
      AND intent.state = 'prepared'
      AND intent.expires_at > clock_timestamp()
  ) OR EXISTS (
    SELECT 1 FROM public.zatca_chain_reservations_v2 reservation
    WHERE reservation.tenant_id = v_branch.tenant_id
      AND reservation.branch_id = v_branch.id
      AND reservation.state = 'allocated'
  ) THEN
    RAISE EXCEPTION 'CHAIN_PREDECESSOR_PENDING';
  END IF;

  SELECT * INTO v_chain_head
  FROM public.zatca_chain_heads_v2
  WHERE tenant_id = v_branch.tenant_id AND branch_id = v_branch.id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAIN_HEAD_RECONCILIATION_REQUIRED'; END IF;

  IF p_document_type = 'invoice' THEN
    UPDATE public.branches SET invoice_counter = invoice_counter + 1
    WHERE id = v_branch.id RETURNING invoice_counter INTO v_document_counter;
    v_prefix := COALESCE(NULLIF(btrim(v_branch.invoice_prefix), ''), 'INV');
  ELSE
    UPDATE public.branches SET credit_note_counter = COALESCE(credit_note_counter, 0) + 1
    WHERE id = v_branch.id RETURNING credit_note_counter INTO v_document_counter;
    v_prefix := COALESCE(NULLIF(btrim(v_branch.invoice_prefix), ''), 'INV') || '-CN';
  END IF;

  INSERT INTO public.zatca_atomic_checkout_intents_v2 (
    tenant_id, branch_id, actor_user_id, document_type,
    idempotency_key, cart_fingerprint, request_payload,
    invoice_id, invoice_uuid, document_counter, invoice_number,
    zatca_counter_number, previous_hash, issue_at, expires_at
  ) VALUES (
    v_branch.tenant_id, v_branch.id, p_actor_user_id, p_document_type,
    v_idempotency_key, p_cart_fingerprint, p_payload,
    gen_random_uuid(), gen_random_uuid(), v_document_counter,
    v_prefix || '-' || lpad(v_document_counter::text, 4, '0'),
    v_chain_head.last_committed_counter + 1, v_chain_head.last_committed_hash,
    clock_timestamp(), clock_timestamp() + make_interval(secs => p_ttl_seconds)
  ) RETURNING * INTO v_intent;

  PERFORM set_config('app.atomic_checkout_intent_id', v_intent.id::text, true);
  PERFORM set_config('app.atomic_checkout_claim_token', v_intent.claim_token::text, true);
  PERFORM set_config('app.atomic_checkout_invoice_id', v_intent.invoice_id::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  -- Exercise the existing authoritative commercial transaction inside a
  -- savepoint, capture its exact output, and deliberately roll it back. The
  -- same RPC is executed again by final commit and must produce the same
  -- snapshot or the outer transaction aborts.
  BEGIN
    IF p_document_type = 'invoice' THEN
      v_preview := public.pos_checkout(p_payload);
    ELSE
      v_preview := public.create_partial_credit_note_with_refund(p_payload);
    END IF;
    v_snapshot := public.build_zatca_atomic_receipt_snapshot_v2(v_intent.invoice_id);
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'ATOMIC_CHECKOUT_PREVIEW_ROLLBACK';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
    NULL;
  END;

  IF v_snapshot IS NULL
     OR (v_snapshot->>'invoice_id')::uuid IS DISTINCT FROM v_intent.invoice_id
     OR v_snapshot->>'invoice_number' IS DISTINCT FROM v_intent.invoice_number THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_PREVIEW_MISMATCH';
  END IF;

  v_snapshot := v_snapshot || jsonb_build_object(
    'invoice_uuid', v_intent.invoice_uuid,
    'zatca_counter_number', v_intent.zatca_counter_number,
    'previous_hash', v_intent.previous_hash,
    'cart_fingerprint', p_cart_fingerprint
  );
  v_snapshot_hash := encode(
    extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  UPDATE public.zatca_atomic_checkout_intents_v2
  SET prepared_snapshot = v_snapshot,
      prepared_snapshot_hash = v_snapshot_hash,
      updated_at = clock_timestamp()
  WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'status', 'prepared',
    'intentId', v_intent.id,
    'claimToken', v_intent.claim_token,
    'snapshot', v_snapshot,
    'snapshotHash', v_snapshot_hash,
    'artifactReady', false,
    'idempotentReplay', false
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_zatca_atomic_checkout_signing_v2(
  p_intent_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer DEFAULT 45
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.zatca_atomic_checkout_intents_v2%ROWTYPE;
  v_signing_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 15 OR p_lease_seconds > 90 THEN
    RAISE EXCEPTION 'INVALID_ATOMIC_SIGNING_LEASE';
  END IF;
  SELECT * INTO v_intent
  FROM public.zatca_atomic_checkout_intents_v2
  WHERE id = p_intent_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_intent.claim_token IS DISTINCT FROM p_claim_token
     OR v_intent.state IS DISTINCT FROM 'prepared'
     OR v_intent.expires_at <= clock_timestamp()
     OR v_intent.prepared_snapshot IS NULL THEN
    RAISE EXCEPTION 'STALE_ATOMIC_CHECKOUT_SIGNING_CLAIM';
  END IF;
  IF v_intent.candidate_signed_xml IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'artifact_ready');
  END IF;
  IF v_intent.signing_lease_token IS NOT NULL
     AND v_intent.signing_lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'leaseExpiresAt', v_intent.signing_lease_expires_at
    );
  END IF;

  UPDATE public.zatca_atomic_checkout_intents_v2
  SET signing_lease_token = v_signing_token,
      signing_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  WHERE id = p_intent_id;
  RETURN jsonb_build_object(
    'status', 'claimed',
    'signingToken', v_signing_token
  );
END
$function$;

DROP FUNCTION IF EXISTS public.store_zatca_atomic_checkout_artifact_v2(
  uuid, uuid, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.store_zatca_atomic_checkout_artifact_v2(
  p_intent_id uuid,
  p_claim_token uuid,
  p_signing_token uuid,
  p_snapshot_hash text,
  p_signed_xml text,
  p_xml_hash text,
  p_signature text,
  p_qr text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.zatca_atomic_checkout_intents_v2%ROWTYPE;
BEGIN
  IF NULLIF(p_signed_xml, '') IS NULL OR NULLIF(btrim(p_xml_hash), '') IS NULL
     OR NULLIF(p_signature, '') IS NULL OR NULLIF(p_qr, '') IS NULL THEN
    RAISE EXCEPTION 'INCOMPLETE_ATOMIC_CHECKOUT_ARTIFACT';
  END IF;
  SELECT * INTO v_intent
  FROM public.zatca_atomic_checkout_intents_v2
  WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND OR v_intent.claim_token IS DISTINCT FROM p_claim_token
     OR v_intent.state IS DISTINCT FROM 'prepared'
     OR v_intent.expires_at <= clock_timestamp()
     OR v_intent.prepared_snapshot_hash IS DISTINCT FROM p_snapshot_hash THEN
    RAISE EXCEPTION 'STALE_ATOMIC_CHECKOUT_ARTIFACT_CLAIM';
  END IF;

  IF v_intent.candidate_signed_xml IS NOT NULL THEN
    IF v_intent.candidate_signed_xml IS DISTINCT FROM p_signed_xml
       OR v_intent.candidate_xml_hash IS DISTINCT FROM btrim(p_xml_hash)
       OR v_intent.candidate_signature IS DISTINCT FROM p_signature
       OR v_intent.candidate_qr IS DISTINCT FROM p_qr THEN
      RAISE EXCEPTION 'ATOMIC_CHECKOUT_ARTIFACT_ALREADY_STORED';
    END IF;
    RETURN jsonb_build_object('status', 'artifact_stored', 'idempotentReplay', true);
  END IF;
  IF p_signing_token IS NULL
     OR v_intent.signing_lease_token IS DISTINCT FROM p_signing_token
     OR v_intent.signing_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'STALE_ATOMIC_CHECKOUT_SIGNING_LEASE';
  END IF;

  UPDATE public.zatca_atomic_checkout_intents_v2
  SET candidate_signed_xml = p_signed_xml,
      candidate_xml_hash = btrim(p_xml_hash),
      candidate_signature = p_signature,
      candidate_qr = p_qr,
      artifact_signed_at = clock_timestamp(),
      signing_lease_token = NULL,
      signing_lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_intent_id;
  RETURN jsonb_build_object('status', 'artifact_stored', 'idempotentReplay', false);
END
$function$;

CREATE OR REPLACE FUNCTION public.commit_zatca_atomic_checkout_v2(
  p_intent_id uuid,
  p_claim_token uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_intent public.zatca_atomic_checkout_intents_v2%ROWTYPE;
  v_head public.zatca_chain_heads_v2%ROWTYPE;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_actual_snapshot jsonb;
  v_expected_core jsonb;
  v_actual_core jsonb;
  v_commercial_result jsonb;
  v_receipt jsonb;
  v_outbox_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_intent
  FROM public.zatca_atomic_checkout_intents_v2
  WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND OR v_intent.claim_token IS DISTINCT FROM p_claim_token
     OR v_intent.actor_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_COMMIT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_intent.state = 'committed' THEN
    RETURN jsonb_build_object(
      'status', 'committed',
      'invoiceId', v_intent.invoice_id,
      'receipt', v_intent.receipt_payload,
      'idempotentReplay', true
    );
  END IF;
  IF v_intent.state IS DISTINCT FROM 'prepared'
     OR v_intent.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_INTENT_EXPIRED';
  END IF;
  IF v_intent.prepared_snapshot IS NULL
     OR v_intent.candidate_signed_xml IS NULL
     OR v_intent.candidate_xml_hash IS NULL
     OR v_intent.candidate_signature IS NULL
     OR v_intent.candidate_qr IS NULL THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_NOT_READY_TO_COMMIT';
  END IF;

  SELECT * INTO v_runtime FROM public.zatca_finalization_runtime WHERE singleton = true;
  IF NOT COALESCE(v_runtime.atomic_simplified_checkout_enabled, false)
     OR NOT EXISTS (
       SELECT 1 FROM public.zatca_atomic_checkout_branch_gates_v2 g
       WHERE g.tenant_id = v_intent.tenant_id
         AND g.branch_id = v_intent.branch_id
         AND g.enabled = true
     ) THEN
    RAISE EXCEPTION 'ATOMIC_SIMPLIFIED_CHECKOUT_DISABLED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_intent.tenant_id::text || ':' || v_intent.branch_id::text, 0
  ));
  SELECT * INTO v_head
  FROM public.zatca_chain_heads_v2
  WHERE tenant_id = v_intent.tenant_id AND branch_id = v_intent.branch_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_head.last_committed_counter + 1 <> v_intent.zatca_counter_number
     OR v_head.last_committed_hash IS DISTINCT FROM v_intent.previous_hash THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_CHAIN_HEAD_CHANGED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.zatca_chain_reservations_v2 r
    WHERE r.tenant_id = v_intent.tenant_id
      AND r.branch_id = v_intent.branch_id
      AND r.state = 'allocated'
  ) THEN
    RAISE EXCEPTION 'CHAIN_PREDECESSOR_PENDING';
  END IF;

  PERFORM set_config('app.atomic_checkout_intent_id', v_intent.id::text, true);
  PERFORM set_config('app.atomic_checkout_claim_token', v_intent.claim_token::text, true);
  PERFORM set_config('app.atomic_checkout_invoice_id', v_intent.invoice_id::text, true);

  IF v_intent.document_type = 'invoice' THEN
    v_commercial_result := public.pos_checkout(v_intent.request_payload);
  ELSE
    v_commercial_result := public.create_partial_credit_note_with_refund(v_intent.request_payload);
  END IF;

  v_actual_snapshot := public.build_zatca_atomic_receipt_snapshot_v2(v_intent.invoice_id)
    || jsonb_build_object(
      'invoice_uuid', v_intent.invoice_uuid,
      'zatca_counter_number', v_intent.zatca_counter_number,
      'previous_hash', v_intent.previous_hash,
      'cart_fingerprint', v_intent.cart_fingerprint
    );
  v_expected_core := v_intent.prepared_snapshot;
  v_actual_core := v_actual_snapshot;
  IF v_actual_core IS DISTINCT FROM v_expected_core THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_SNAPSHOT_CHANGED';
  END IF;

  INSERT INTO public.zatca_chain_reservations_v2 (
    tenant_id, branch_id, invoice_id, claim_token, counter_number,
    previous_hash, committed_artifact_hash, state, allocated_at, committed_at
  ) VALUES (
    v_intent.tenant_id, v_intent.branch_id, v_intent.invoice_id,
    v_intent.claim_token, v_intent.zatca_counter_number,
    v_intent.previous_hash, v_intent.candidate_xml_hash,
    'committed', v_intent.created_at, clock_timestamp()
  );

  UPDATE public.zatca_chain_heads_v2
  SET last_committed_counter = v_intent.zatca_counter_number,
      last_committed_hash = v_intent.candidate_xml_hash,
      updated_at = clock_timestamp()
  WHERE tenant_id = v_intent.tenant_id AND branch_id = v_intent.branch_id;

  UPDATE public.invoices
  SET zatca_uuid = v_intent.invoice_uuid,
      zatca_counter_number = v_intent.zatca_counter_number,
      zatca_prev_invoice_hash = v_intent.previous_hash,
      zatca_finalization_version = 2,
      zatca_artifact_provenance = 'server_v2',
      zatca_document_kind = 'simplified',
      zatca_lifecycle_state = 'locally_finalized',
      zatca_artifact_stage = 'simplified_final',
      zatca_simplified_xml = v_intent.candidate_signed_xml,
      zatca_simplified_xml_hash = v_intent.candidate_xml_hash,
      zatca_simplified_signature = v_intent.candidate_signature,
      zatca_simplified_qr = v_intent.candidate_qr,
      zatca_finalized_at_v2 = clock_timestamp(),
      zatca_finalization_error_v2 = NULL
  WHERE id = v_intent.invoice_id
    AND tenant_id = v_intent.tenant_id
    AND branch_id = v_intent.branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATOMIC_CHECKOUT_INVOICE_COMMIT_FAILED'; END IF;

  INSERT INTO public.zatca_reporting_outbox_v2 (
    tenant_id, branch_id, invoice_id, operation, artifact_hash, status, source
  ) VALUES (
    v_intent.tenant_id, v_intent.branch_id, v_intent.invoice_id,
    'report', v_intent.candidate_xml_hash, 'pending', 'atomic_checkout'
  )
  RETURNING id INTO v_outbox_id;

  v_receipt := v_actual_snapshot || jsonb_build_object(
    'qr_code', v_intent.candidate_qr,
    'can_print', true,
    'reporting_display_state', 'reporting_pending',
    'finalization_status', 'locally_finalized',
    'artifact_stage', 'simplified_final',
    'document_kind', 'simplified',
    'outbox_id', v_outbox_id,
    'transaction_committed_at', clock_timestamp()
  );

  UPDATE public.zatca_atomic_checkout_intents_v2
  SET state = 'committed',
      receipt_payload = v_receipt,
      committed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'status', 'committed',
    'invoiceId', v_intent.invoice_id,
    'receipt', v_receipt,
    'idempotentReplay', false
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.get_zatca_atomic_checkout_result_v2(
  p_actor_user_id uuid,
  p_branch_id uuid,
  p_idempotency_key text,
  p_cart_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.zatca_atomic_checkout_intents_v2%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.zatca_atomic_checkout_intents_v2
  WHERE actor_user_id = p_actor_user_id
    AND branch_id = p_branch_id
    AND idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_intent.cart_fingerprint IS DISTINCT FROM p_cart_fingerprint THEN
    RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH';
  END IF;
  RETURN jsonb_build_object(
    'status', v_intent.state,
    'invoiceId', v_intent.invoice_id,
    'receipt', CASE WHEN v_intent.state = 'committed' THEN v_intent.receipt_payload ELSE NULL END
  );
END
$function$;

-- Durable response evidence is appended before any invoice/outbox state
-- transition. The table deliberately has no update/delete path.
CREATE TABLE IF NOT EXISTS public.zatca_reporting_response_evidence_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL REFERENCES public.zatca_reporting_outbox_v2(id) ON DELETE RESTRICT,
  network_token uuid NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  http_status integer NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  reporting_status text,
  validation_status text,
  warning_codes text[] NOT NULL DEFAULT '{}',
  error_codes text[] NOT NULL DEFAULT '{}',
  classified_outcome text NOT NULL CHECK (
    classified_outcome IN ('accepted', 'transient_failure', 'definite_rejection', 'ambiguous_outcome')
  ),
  safe_response jsonb NOT NULL,
  safe_warnings jsonb,
  safe_reason text,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (outbox_id, network_token)
);

ALTER TABLE public.zatca_reporting_response_evidence_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_reporting_response_evidence_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.zatca_reporting_response_evidence_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.reject_zatca_response_evidence_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'ZATCA_RESPONSE_EVIDENCE_IS_APPEND_ONLY';
END
$function$;

DROP TRIGGER IF EXISTS zatca_response_evidence_append_only_v2
ON public.zatca_reporting_response_evidence_v2;
CREATE TRIGGER zatca_response_evidence_append_only_v2
BEFORE UPDATE OR DELETE ON public.zatca_reporting_response_evidence_v2
FOR EACH ROW EXECUTE FUNCTION public.reject_zatca_response_evidence_mutation_v2();

CREATE OR REPLACE FUNCTION public.append_zatca_reporting_response_evidence_v2(
  p_outbox_id uuid,
  p_outbox_token uuid,
  p_network_token uuid,
  p_http_status integer,
  p_reporting_status text,
  p_validation_status text,
  p_warning_codes text[],
  p_error_codes text[],
  p_outcome text,
  p_safe_response jsonb,
  p_safe_warnings jsonb,
  p_safe_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_evidence public.zatca_reporting_response_evidence_v2%ROWTYPE;
BEGIN
  IF p_safe_response IS NULL OR p_http_status NOT BETWEEN 100 AND 599
     OR p_outcome NOT IN ('accepted', 'transient_failure', 'definite_rejection', 'ambiguous_outcome') THEN
    RAISE EXCEPTION 'INVALID_ZATCA_RESPONSE_EVIDENCE';
  END IF;
  SELECT * INTO v_outbox FROM public.zatca_reporting_outbox_v2
  WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND OR v_outbox.lease_token IS DISTINCT FROM p_outbox_token
     OR v_outbox.status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'STALE_OUTBOX_EVIDENCE_TOKEN';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_outbox.invoice_id FOR UPDATE;
  IF v_invoice.zatca_network_claim_token_v2 IS DISTINCT FROM p_network_token
     OR v_invoice.zatca_network_ack_state_v2 IS DISTINCT FROM 'request_started' THEN
    RAISE EXCEPTION 'STALE_NETWORK_EVIDENCE_TOKEN';
  END IF;

  INSERT INTO public.zatca_reporting_response_evidence_v2 (
    tenant_id, branch_id, invoice_id, outbox_id, network_token,
    attempt_count, http_status, reporting_status, validation_status,
    warning_codes, error_codes, classified_outcome,
    safe_response, safe_warnings, safe_reason
  ) VALUES (
    v_outbox.tenant_id, v_outbox.branch_id, v_outbox.invoice_id, v_outbox.id,
    p_network_token, v_outbox.attempt_count, p_http_status,
    NULLIF(btrim(p_reporting_status), ''), NULLIF(btrim(p_validation_status), ''),
    COALESCE(p_warning_codes, '{}'), COALESCE(p_error_codes, '{}'), p_outcome,
    p_safe_response, p_safe_warnings, NULLIF(btrim(p_safe_reason), '')
  )
  ON CONFLICT (outbox_id, network_token) DO NOTHING
  RETURNING * INTO v_evidence;
  IF NOT FOUND THEN
    SELECT * INTO v_evidence
    FROM public.zatca_reporting_response_evidence_v2
    WHERE outbox_id = p_outbox_id AND network_token = p_network_token;
    IF v_evidence.http_status IS DISTINCT FROM p_http_status
       OR v_evidence.classified_outcome IS DISTINCT FROM p_outcome
       OR v_evidence.safe_response IS DISTINCT FROM p_safe_response THEN
      RAISE EXCEPTION 'ZATCA_RESPONSE_EVIDENCE_CONFLICT';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'evidence_recorded',
    'evidenceId', v_evidence.id,
    'receivedAt', v_evidence.received_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.apply_zatca_reporting_response_evidence_v2(
  p_outbox_id uuid,
  p_outbox_token uuid,
  p_network_token uuid,
  p_evidence_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_evidence public.zatca_reporting_response_evidence_v2%ROWTYPE;
BEGIN
  SELECT * INTO v_evidence
  FROM public.zatca_reporting_response_evidence_v2
  WHERE id = p_evidence_id
    AND outbox_id = p_outbox_id
    AND network_token = p_network_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZATCA_RESPONSE_EVIDENCE_NOT_FOUND'; END IF;

  RETURN public.persist_zatca_reporting_outbox_result_v2(
    p_outbox_id,
    p_outbox_token,
    p_network_token,
    v_evidence.classified_outcome,
    v_evidence.safe_response,
    v_evidence.safe_warnings,
    v_evidence.safe_reason
  );
END
$function$;

-- Safe customer-output state. Reporting is non-blocking only for a complete
-- immutable simplified artifact; standard documents remain clearance-gated.
CREATE OR REPLACE FUNCTION public.get_zatca_output_state_v2(
  p_invoice_id uuid,
  p_tenant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_can_output boolean := false;
  v_qr text;
  v_reporting_display_state text;
  v_warning_count integer := 0;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = p_invoice_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2' THEN
    v_can_output := v_invoice.zatca_status IN ('reported', 'cleared')
      AND NULLIF(BTRIM(v_invoice.zatca_qr_code), '') IS NOT NULL;
    RETURN jsonb_build_object(
      'invoiceId', v_invoice.id,
      'invoiceStatus', COALESCE(v_invoice.zatca_status, 'not_submitted'),
      'contractMode', 'legacy', 'legacyCompatible', true,
      'finalizationStatus', 'legacy_' || COALESCE(v_invoice.zatca_status, 'not_submitted'),
      'artifactStage', CASE WHEN v_can_output THEN 'legacy_final' ELSE 'legacy_pending' END,
      'documentKind', CASE
        WHEN v_invoice.zatca_invoice_type IN ('simplified', 'standard')
          THEN v_invoice.zatca_invoice_type
        ELSE NULL
      END,
      'reportingDisplayState', CASE
        WHEN v_invoice.zatca_status = 'reported' THEN 'reported'
        WHEN v_invoice.zatca_status = 'failed' THEN 'rejected'
        ELSE 'reporting_pending'
      END,
      'canPrint', v_can_output, 'canShare', v_can_output,
      'retryAvailable', v_invoice.zatca_status IN ('pending', 'failed'),
      'reconciliationRequired', false,
      'qrCode', CASE WHEN v_can_output THEN v_invoice.zatca_qr_code ELSE NULL END,
      'error', NULL
    );
  END IF;

  IF v_invoice.zatca_document_kind = 'simplified'
     AND v_invoice.zatca_artifact_stage = 'simplified_final'
     AND NULLIF(BTRIM(v_invoice.zatca_simplified_xml), '') IS NOT NULL
     AND NULLIF(BTRIM(v_invoice.zatca_simplified_xml_hash), '') IS NOT NULL
     AND NULLIF(BTRIM(v_invoice.zatca_simplified_signature), '') IS NOT NULL
     AND NULLIF(BTRIM(v_invoice.zatca_simplified_qr), '') IS NOT NULL THEN
    v_can_output := true;
    v_qr := v_invoice.zatca_simplified_qr;
    SELECT * INTO v_outbox
    FROM public.zatca_reporting_outbox_v2
    WHERE invoice_id = v_invoice.id AND operation = 'report';

    IF jsonb_typeof(v_invoice.zatca_warnings->'warnings') = 'array' THEN
      v_warning_count := jsonb_array_length(v_invoice.zatca_warnings->'warnings');
    END IF;
    v_reporting_display_state := CASE
      WHEN v_invoice.zatca_lifecycle_state = 'reconciliation_required'
        OR v_invoice.zatca_network_ack_state_v2 = 'reconciliation_required'
        THEN 'reconciliation_required'
      WHEN v_invoice.zatca_status = 'reported' AND v_warning_count > 0
        THEN 'reported_with_warnings'
      WHEN v_invoice.zatca_status = 'reported' THEN 'reported'
      WHEN v_outbox.status = 'retryable' THEN 'retryable_failure'
      WHEN v_outbox.status = 'blocked'
        AND v_outbox.last_outcome = 'definite_rejection' THEN 'rejected'
      WHEN v_outbox.status = 'blocked' THEN 'manual_review_required'
      ELSE 'reporting_pending'
    END;
  ELSIF v_invoice.zatca_document_kind = 'standard'
     AND v_invoice.zatca_artifact_stage = 'standard_cleared'
     AND v_invoice.zatca_lifecycle_state = 'cleared_final'
     AND NULLIF(BTRIM(v_invoice.zatca_cleared_qr), '') IS NOT NULL THEN
    v_can_output := true;
    v_qr := v_invoice.zatca_cleared_qr;
    v_reporting_display_state := 'cleared';
  ELSE
    v_reporting_display_state := CASE
      WHEN v_invoice.zatca_document_kind = 'standard' THEN 'clearance_pending'
      ELSE 'manual_review_required'
    END;
  END IF;

  RETURN jsonb_build_object(
    'invoiceId', v_invoice.id,
    'invoiceStatus', COALESCE(v_invoice.zatca_status, 'pending'),
    'contractMode', 'v2', 'legacyCompatible', false,
    'finalizationStatus', v_invoice.zatca_lifecycle_state,
    'artifactStage', v_invoice.zatca_artifact_stage,
    'documentKind', v_invoice.zatca_document_kind,
    'reportingDisplayState', v_reporting_display_state,
    'canPrint', v_can_output, 'canShare', v_can_output,
    'retryAvailable', CASE
      WHEN v_invoice.zatca_document_kind = 'simplified'
        AND v_invoice.zatca_artifact_stage = 'simplified_final'
        THEN v_outbox.status = 'retryable'
      ELSE v_invoice.zatca_lifecycle_state IN (
        'not_started', 'finalization_failed', 'clearance_failed', 'retrying'
      )
    END,
    'reconciliationRequired', v_invoice.zatca_lifecycle_state = 'reconciliation_required',
    'qrCode', CASE WHEN v_can_output THEN v_qr ELSE NULL END,
    'error', CASE
      WHEN v_invoice.zatca_lifecycle_state = 'reconciliation_required'
        THEN COALESCE(v_invoice.zatca_reconciliation_reason_v2, 'Remote outcome requires reconciliation.')
      ELSE v_invoice.zatca_finalization_error_v2 ->> 'message'
    END
  );
END
$function$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'assert_zatca_atomic_checkout_intent_immutable_v2',
      'apply_zatca_atomic_checkout_identity_v2',
      'prevent_zatca_chain_intent_overtake_v2',
      'build_zatca_atomic_receipt_snapshot_v2',
      'prepare_zatca_atomic_checkout_v2',
      'claim_zatca_atomic_checkout_signing_v2',
      'store_zatca_atomic_checkout_artifact_v2',
      'commit_zatca_atomic_checkout_v2',
      'get_zatca_atomic_checkout_result_v2',
      'expire_zatca_atomic_checkout_intents_v2',
      'reject_zatca_response_evidence_mutation_v2',
      'append_zatca_reporting_response_evidence_v2',
      'apply_zatca_reporting_response_evidence_v2',
      'get_zatca_output_state_v2'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
  END LOOP;
END
$grants$;

GRANT EXECUTE ON FUNCTION public.prepare_zatca_atomic_checkout_v2(uuid, text, jsonb, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_zatca_atomic_checkout_signing_v2(uuid, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.store_zatca_atomic_checkout_artifact_v2(uuid, uuid, uuid, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_zatca_atomic_checkout_v2(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_zatca_atomic_checkout_result_v2(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_zatca_atomic_checkout_intents_v2(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.append_zatca_reporting_response_evidence_v2(
  uuid, uuid, uuid, integer, text, text, text[], text[], text, jsonb, jsonb, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_zatca_reporting_response_evidence_v2(uuid, uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_zatca_output_state_v2(uuid, uuid)
  TO service_role;

COMMENT ON TABLE public.zatca_atomic_checkout_intents_v2 IS
  'Short-lived non-issued simplified checkout intents. Candidate artifacts are private and never buyer-visible.';
COMMENT ON TABLE public.zatca_reporting_response_evidence_v2 IS
  'Append-only sanitized evidence recorded before reporting state application. Never store credentials, auth headers, private keys, or raw requests.';

COMMIT;
