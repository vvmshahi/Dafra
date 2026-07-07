-- ============================================================
-- Phase 5B: Financial Write Lockdown and Active-User RLS Helpers
-- Apply manually after Phase 4E/5C checkout and credit-note RPCs are in place.
-- ============================================================
--
-- Goals:
--   - Prevent browser/client direct writes to authoritative financial tables.
--   - Keep invoice/item/payment reads scoped by tenant/branch role.
--   - Preserve POS checkout and credit-note RPC write paths.
--   - Ensure inactive user_profiles rows receive no RLS helper privileges.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data directly.
--   - Do not change invoice numbering, VAT/tax/payment math, stock deduction,
--     split payment logic, ZATCA XML/signing/submission, printer, Electron,
--     purchases, expenses, register sessions, branch limits, or suspension.

BEGIN;

-- ============================================================
-- Active-user legacy helper hardening
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.tenant_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.branch_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.role
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role::text = 'super_admin'
      AND up.is_active IS TRUE
  )
$$;

-- Keep the newer Phase 3A helper family aligned when present.
CREATE OR REPLACE FUNCTION public.rls_current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.tenant_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_current_branch_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.branch_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_current_role_text()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.role::text
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rls_current_role_text() = 'super_admin', FALSE)
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_branch_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_current_branch_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_current_role_text() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_is_super_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_branch_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_current_tenant_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_current_branch_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_current_role_text() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_super_admin() TO anon, authenticated, service_role;

-- ============================================================
-- Financial table write lockdown
-- ============================================================

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Drop historical direct-write policies and old read policy names so the
-- authoritative final state is explicit and idempotent.
DROP POLICY IF EXISTS "invoices_super_admin" ON public.invoices;
DROP POLICY IF EXISTS "invoices_super_admin_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_super_admin_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_super_admin_update" ON public.invoices;
DROP POLICY IF EXISTS "invoices_super_admin_delete" ON public.invoices;
DROP POLICY IF EXISTS "invoices_owner_all" ON public.invoices;
DROP POLICY IF EXISTS "invoices_owner_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_owner_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_owner_update" ON public.invoices;
DROP POLICY IF EXISTS "invoices_owner_delete" ON public.invoices;
DROP POLICY IF EXISTS "invoices_manager_branch" ON public.invoices;
DROP POLICY IF EXISTS "invoices_manager_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_manager_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_manager_update" ON public.invoices;
DROP POLICY IF EXISTS "invoices_manager_delete" ON public.invoices;
DROP POLICY IF EXISTS "invoices_cashier_branch" ON public.invoices;
DROP POLICY IF EXISTS "invoices_cashier_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_cashier_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_cashier_update" ON public.invoices;
DROP POLICY IF EXISTS "invoices_cashier_delete" ON public.invoices;
DROP POLICY IF EXISTS "invoices_accountant_read" ON public.invoices;
DROP POLICY IF EXISTS "invoices_branch_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_branch_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_branch_update" ON public.invoices;
DROP POLICY IF EXISTS "invoices_branch_delete" ON public.invoices;
DROP POLICY IF EXISTS "Owners and accountants can view all invoices" ON public.invoices;
DROP POLICY IF EXISTS "Owners can view all invoices" ON public.invoices;
DROP POLICY IF EXISTS "Owners and accountants can manage invoices" ON public.invoices;
DROP POLICY IF EXISTS phase3a_invoices_select ON public.invoices;
DROP POLICY IF EXISTS phase3a_invoices_qr_backfill_update ON public.invoices;
DROP POLICY IF EXISTS phase5b_invoices_select ON public.invoices;

DROP POLICY IF EXISTS "invoice_items_super_admin" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_select" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_insert" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_update" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_super_admin_delete" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_select" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_insert" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_update" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_tenant_delete" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_select" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_insert" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_update" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_owner_delete" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_read" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_select" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_insert" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_update" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_branch_delete" ON public.invoice_items;
DROP POLICY IF EXISTS phase3a_invoice_items_select ON public.invoice_items;
DROP POLICY IF EXISTS phase5b_invoice_items_select ON public.invoice_items;

DROP POLICY IF EXISTS "payments_super_admin" ON public.payments;
DROP POLICY IF EXISTS "payments_super_admin_select" ON public.payments;
DROP POLICY IF EXISTS "payments_super_admin_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_super_admin_update" ON public.payments;
DROP POLICY IF EXISTS "payments_super_admin_delete" ON public.payments;
DROP POLICY IF EXISTS "payments_owner_all" ON public.payments;
DROP POLICY IF EXISTS "payments_owner_select" ON public.payments;
DROP POLICY IF EXISTS "payments_owner_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_owner_update" ON public.payments;
DROP POLICY IF EXISTS "payments_owner_delete" ON public.payments;
DROP POLICY IF EXISTS "payments_manager_cashier" ON public.payments;
DROP POLICY IF EXISTS "payments_manager_cashier_select" ON public.payments;
DROP POLICY IF EXISTS "payments_manager_cashier_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_manager_cashier_update" ON public.payments;
DROP POLICY IF EXISTS "payments_manager_cashier_delete" ON public.payments;
DROP POLICY IF EXISTS "payments_accountant_read" ON public.payments;
DROP POLICY IF EXISTS "payments_branch_select" ON public.payments;
DROP POLICY IF EXISTS "payments_branch_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_branch_update" ON public.payments;
DROP POLICY IF EXISTS "payments_branch_delete" ON public.payments;
DROP POLICY IF EXISTS phase3a_payments_select ON public.payments;
DROP POLICY IF EXISTS phase5b_payments_select ON public.payments;

CREATE POLICY phase5b_invoices_select
  ON public.invoices
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      tenant_id = public.get_my_tenant_id()
      AND public.get_my_role()::text IN ('owner', 'admin')
    )
    OR (
      tenant_id = public.get_my_tenant_id()
      AND public.get_my_role()::text IN ('branch', 'manager', 'cashier', 'accountant')
      AND branch_id = public.get_my_branch_id()
    )
  );

CREATE POLICY phase5b_invoice_items_select
  ON public.invoice_items
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          (
            i.tenant_id = public.get_my_tenant_id()
            AND public.get_my_role()::text IN ('owner', 'admin')
          )
          OR (
            i.tenant_id = public.get_my_tenant_id()
            AND public.get_my_role()::text IN ('branch', 'manager', 'cashier', 'accountant')
            AND i.branch_id = public.get_my_branch_id()
          )
        )
    )
  );

CREATE POLICY phase5b_payments_select
  ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = payments.invoice_id
        AND (
          (
            i.tenant_id = public.get_my_tenant_id()
            AND public.get_my_role()::text IN ('owner', 'admin')
          )
          OR (
            i.tenant_id = public.get_my_tenant_id()
            AND public.get_my_role()::text IN ('branch', 'manager', 'cashier', 'accountant')
            AND i.branch_id = public.get_my_branch_id()
          )
        )
    )
  );

-- Existing SECURITY DEFINER RPCs own authorized writes. Keep row_security off
-- for these functions so the newly read-only browser RLS state does not block
-- their already-internal authorization and insert/update logic.
DO $$
BEGIN
  IF to_regprocedure('public.pos_checkout(jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.pos_checkout(JSONB) SET row_security = off;
  END IF;

  IF to_regprocedure('public.create_full_credit_note(jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.create_full_credit_note(JSONB) SET row_security = off;
  END IF;

  IF to_regprocedure('public.create_full_credit_note_unchecked(jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.create_full_credit_note_unchecked(JSONB) SET row_security = off;
  END IF;
END $$;

COMMENT ON POLICY phase5b_invoices_select ON public.invoices IS
  'Phase 5B: authenticated users may read scoped invoices only; direct browser writes are blocked.';

COMMENT ON POLICY phase5b_invoice_items_select ON public.invoice_items IS
  'Phase 5B: authenticated users may read scoped invoice items via parent invoice only; direct browser writes are blocked.';

COMMENT ON POLICY phase5b_payments_select ON public.payments IS
  'Phase 5B: authenticated users may read scoped payments via parent invoice only; direct browser writes are blocked.';

NOTIFY pgrst, 'reload schema';

COMMIT;
