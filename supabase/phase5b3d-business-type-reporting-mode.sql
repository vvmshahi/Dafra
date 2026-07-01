-- ============================================================
-- Phase 5B-3D hotfix: business type and reporting mode setup
-- Apply manually after Phase 5B-3B/3C reporting and expense hotfixes.
-- ============================================================
--
-- Goals:
--   - Store tenant-level business_type for launch reporting/UX guidance.
--   - Support only trading and service business types.
--   - Preserve current behavior for existing tenants by defaulting to trading.
--   - Prevent service-business credit notes from adding quantity back to stock.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not modify ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not implement FIFO/COGS ledger, BOM/recipe, or full accounting.

BEGIN;

-- ============================================================
-- Tenant business type
-- ============================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'trading';

ALTER TABLE public.tenants
  ALTER COLUMN business_type SET DEFAULT 'trading';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND conname = 'tenants_business_type_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_business_type_check
      CHECK (
        business_type IS NULL
        OR business_type IN ('trading', 'service')
      )
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.business_type IS
  'Launch reporting/UX mode for tenant: trading or service. NULL is treated as trading for backward compatibility.';

-- ============================================================
-- Service-business credit note stock guard
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.create_full_credit_note_unchecked(jsonb)') IS NULL
     AND to_regprocedure('public.create_full_credit_note(jsonb)') IS NOT NULL
  THEN
    ALTER FUNCTION public.create_full_credit_note(JSONB)
      RENAME TO create_full_credit_note_unchecked;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_full_credit_note(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_original_invoice_id UUID;
  v_tenant_business_type TEXT := 'trading';
  v_payload JSONB := p_payload;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid credit note payload' USING ERRCODE = '22023';
  END IF;

  v_original_invoice_id := NULLIF(TRIM(COALESCE(p_payload ->> 'original_invoice_id', '')), '')::uuid;

  IF v_original_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Missing original invoice' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(t.business_type, 'trading')
    INTO v_tenant_business_type
  FROM public.invoices i
  JOIN public.tenants t ON t.id = i.tenant_id
  WHERE i.id = v_original_invoice_id;

  IF v_tenant_business_type = 'service' THEN
    v_payload := jsonb_set(v_payload, '{return_stock}', 'false'::jsonb, TRUE);
  END IF;

  RETURN public.create_full_credit_note_unchecked(v_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.create_full_credit_note(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_full_credit_note(JSONB) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.create_full_credit_note_unchecked(jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.create_full_credit_note_unchecked(JSONB) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.create_full_credit_note_unchecked(JSONB) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.create_full_credit_note(JSONB) IS
  'User-facing credit note RPC. Preserves Phase 2C behavior but forces return_stock=false for service tenants.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm tenant business_type column and default:
--
-- SELECT column_name, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'tenants'
--   AND column_name = 'business_type';
--
-- 2) Confirm values are safe for existing tenants:
--
-- SELECT business_type, COUNT(*)
-- FROM public.tenants
-- GROUP BY business_type
-- ORDER BY business_type NULLS FIRST;
--
-- Expected:
--   Existing rows should read trading on first application unless explicitly
--   changed later. NULL remains tolerated and is treated as trading by app/RPC.
--
-- 3) Confirm callable credit note wrapper remains available:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.create_full_credit_note(jsonb)',
--   'EXECUTE'
-- ) AS can_create_credit_note;
--
-- Expected: true.
--
-- 4) Service tenant stock guard:
--   In an authenticated app context, create a credit note for a service tenant
--   with return_stock=true. Expected: credit note is created normally, ZATCA
--   submission path remains unchanged, and no stock is added back.
