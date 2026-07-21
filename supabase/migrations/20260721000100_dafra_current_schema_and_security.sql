-- Dafra canonical schema-only baseline.
-- Canonicalized from the final active definitions reached by the curated sources:
-- supabase/schema.sql
-- supabase/update-branches.sql
-- supabase/update-products.sql
-- supabase/update-customers.sql
-- supabase/update-expenses.sql
-- supabase/update-inventory.sql
-- supabase/update-tenants.sql
-- supabase/update-zatca.sql
-- supabase/add-employees.sql
-- supabase/add-day-closing.sql
-- supabase/fix-all-rls.sql
-- supabase/update-roles-part1.sql
-- supabase/update-roles-part2.sql
-- supabase/fix-onboarding-v2.sql
-- supabase/final-rls-fix.sql
-- supabase/fix-complete-onboarding.sql
-- supabase/add-branch-email.sql
-- supabase/fix-branch-permissions.sql
-- supabase/update-invoice-settings.sql
-- supabase/add-customer-type.sql
-- supabase/add-pos-sessions.sql
-- supabase/fix-branch-isolation.sql
-- supabase/fix-invoice-counter.sql
-- supabase/update-plans.sql
-- supabase/fix-invoice-items-rls.sql
-- supabase/zatca-production-onboarding.sql
-- supabase/zatca-production-disconnect.sql
-- supabase/phase1-user-profiles-self-update-lockdown.sql
-- supabase/phase2b-pos-payment-tender.sql
-- supabase/phase2c-full-credit-note.sql
-- supabase/phase3a-rls-canonical-lockdown.sql
-- supabase/phase3c-rate-limit-audit.sql
-- supabase/phase3c-branch-invoice-settings-rpc-fix.sql
-- supabase/phase4b-simple-purchase-bill.sql
-- supabase/phase4b-delete-simple-purchase-bill-permission-fix.sql
-- supabase/phase4c-safe-purchase-receiving.sql
-- supabase/phase4c-purchase-ux-simplification.sql
-- supabase/phase4d-supplier-item-mapping-attachments.sql
-- supabase/phase5b3b-reporting-foundation.sql
-- supabase/phase5b3b-reporting-compatibility-hotfix.sql
-- supabase/phase5b3c-reporting-rpc-cache-and-purchase-actions-hotfix.sql
-- supabase/phase5b3b-sales-report-hotfix.sql
-- supabase/phase5b3c-expense-vat-claimability.sql
-- supabase/phase5b3d-business-type-reporting-mode.sql
-- supabase/phase5c2-split-payment.sql
-- supabase/phase5c2a-dashboard-branch-and-pos-settings-hotfix.sql
-- supabase/phase5c2b-dashboard-and-split-settings-hotfix.sql
-- supabase/phase5c3-dashboard-and-credit-note-hotfix.sql
-- supabase/phase5c3a-dashboard-kpi-pipeline-hotfix.sql
-- supabase/phase5c5a-register-session-reporting-foundation.sql
-- supabase/phase5c5b-register-session-rpc-availability-hotfix.sql
-- supabase/phase5c5c-register-session-summary-argument-limit-hotfix.sql
-- supabase/phase5c6-pos-touch-navigation-buttons.sql
-- supabase/phase3b-branch-username-login-foundation.sql
-- supabase/phase4b-manual-subscription-foundation.sql
-- supabase/phase4d-super-admin-billing-summary.sql
-- supabase/phase4e-branch-limit-and-manual-suspension-enforcement.sql
-- supabase/phase4h-owner-setup-completion-tracking.sql
-- supabase/phase5b-financial-write-lockdown-and-active-rls.sql
-- supabase/phase5e-branch-operations-permission-hardening.sql
-- supabase/phase5f-branch-stock-module-toggle.sql
-- supabase/phase-reports-b2-date-filters-and-supplier-totals.sql
-- supabase/phase5g-fix-purchase-supplier-scope-validation.sql
-- supabase/phase5h-fix-product-category-scope-validation.sql
-- supabase/phase5i-invoice-list-performance-indexes.sql
-- supabase/phase5j-partial-item-credit-notes.sql
-- supabase/phase5k-branch-pos-mode.sql
-- supabase/phase5l-product-stock-tracking-controls.sql
-- supabase/phase5m-product-stock-receipts.sql
-- supabase/phase5n-credit-note-session-linkage.sql
-- supabase/phase5o-product-sku-generation.sql
-- supabase/phase5v-expense-vat-supporting-details.sql
-- supabase/phase5w-split-refund-allocation.sql



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."certificate_status" AS ENUM (
    'pending',
    'active',
    'revoked',
    'expired',
    'compliance'
);


ALTER TYPE "public"."certificate_status" OWNER TO "postgres";


CREATE TYPE "public"."invoice_status" AS ENUM (
    'draft',
    'posted',
    'cancelled'
);


ALTER TYPE "public"."invoice_status" OWNER TO "postgres";


CREATE TYPE "public"."invoice_type" AS ENUM (
    'standard',
    'simplified',
    'credit_note',
    'debit_note'
);


ALTER TYPE "public"."invoice_type" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'cash',
    'card',
    'bank_transfer',
    'other'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'paid',
    'partial',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."subscription_status" AS ENUM (
    'trial',
    'active',
    'expired',
    'cancelled'
);


ALTER TYPE "public"."subscription_status" OWNER TO "postgres";


CREATE TYPE "public"."sync_status" AS ENUM (
    'pending',
    'processing',
    'success',
    'failed'
);


ALTER TYPE "public"."sync_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'super_admin',
    'owner',
    'branch'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE TYPE "public"."zatca_status" AS ENUM (
    'not_submitted',
    'pending',
    'reported',
    'cleared',
    'failed'
);


ALTER TYPE "public"."zatca_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_product_write_access"("p_branch_id" "uuid") RETURNS TABLE("tenant_id" "uuid", "branch_id" "uuid")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_profile RECORD;
  v_branch RECORD;
  v_tenant RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.product_rpc_profile();

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role NOT IN ('super_admin', 'owner', 'branch') THEN
    RAISE EXCEPTION 'Insufficient permission to manage products' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active
    INTO v_branch
  FROM public.branches b
  WHERE b.id = COALESCE(p_branch_id, v_profile.branch_id);

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.is_active
    INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_branch.tenant_id;

  IF NOT FOUND OR v_tenant.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Business account is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    RETURN QUERY SELECT v_branch.tenant_id, v_branch.id;
    RETURN;
  END IF;

  IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch'
     AND v_profile.branch_id IS DISTINCT FROM v_branch.id THEN
    RAISE EXCEPTION 'Branch belongs to another profile' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_branch.tenant_id, v_branch.id;
END;
$$;


ALTER FUNCTION "public"."assert_product_write_access"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_actor_role"("p_actor_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT up.role::text
  FROM public.user_profiles up
  WHERE up.id = p_actor_user_id
  LIMIT 1
$$;


ALTER FUNCTION "public"."audit_actor_role"("p_actor_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_branch_write_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_action TEXT;
  v_row public.branches%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'branch_created';
    v_row := NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'branch_updated';
    v_row := NEW;
  ELSE
    v_action := 'branch_deleted';
    v_row := OLD;
  END IF;

  PERFORM public.record_audit_event(
    v_action,
    v_row.tenant_id,
    v_row.id,
    auth.uid(),
    NULL,
    'branch',
    v_row.id,
    CASE WHEN TG_OP = 'DELETE' THEN 'warning' ELSE 'info' END,
    'succeeded',
    jsonb_build_object(
      'operation', TG_OP,
      'is_active', v_row.is_active,
      'zatca_phase', v_row.zatca_phase
    ),
    NULL,
    NULL
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."audit_branch_write_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_invoice_insert_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF NEW.zatca_invoice_type::text = 'credit_note' THEN
    v_action := 'credit_note_created';
  ELSIF NEW.checkout_idempotency_key IS NOT NULL THEN
    v_action := 'pos_checkout_created';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.record_audit_event(
    v_action,
    NEW.tenant_id,
    NEW.branch_id,
    NEW.created_by,
    NULL,
    'invoice',
    NEW.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'invoice_number', NEW.invoice_number,
      'zatca_invoice_type', NEW.zatca_invoice_type::text,
      'payment_method', NEW.payment_method::text,
      'payment_status', NEW.payment_status::text,
      'status', NEW.status::text,
      'total_amount', NEW.total_amount,
      'original_invoice_id', NEW.original_invoice_id
    ),
    NULL,
    NULL
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_invoice_insert_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_purchase_write_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_audit_event(
      'purchase_bill_created',
      NEW.tenant_id,
      NEW.branch_id,
      NEW.added_by,
      NULL,
      'purchase',
      NEW.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', NEW.purchase_mode,
        'status', NEW.status,
        'tax_input_mode', NEW.tax_input_mode,
        'payment_status', NEW.payment_status,
        'payment_method', NEW.payment_method,
        'has_bill_number', NEW.bill_number IS NOT NULL,
        'has_bill_url', NEW.bill_url IS NOT NULL,
        'total_amount', NEW.total_amount
      ),
      NULL,
      NULL
    );
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.record_audit_event(
      'purchase_bill_updated',
      NEW.tenant_id,
      NEW.branch_id,
      auth.uid(),
      NULL,
      'purchase',
      NEW.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', NEW.purchase_mode,
        'status', NEW.status,
        'tax_input_mode', NEW.tax_input_mode,
        'payment_status', NEW.payment_status,
        'payment_method', NEW.payment_method,
        'has_bill_number', NEW.bill_number IS NOT NULL,
        'has_bill_url', NEW.bill_url IS NOT NULL,
        'total_amount', NEW.total_amount
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_purchase_write_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_safe_metadata"("p_metadata" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(p_metadata, '{}'::jsonb) - ARRAY[
    'authorization',
    'auth_header',
    'bearer',
    'token',
    'access_token',
    'refresh_token',
    'service_role_key',
    'password',
    'new_password',
    'otp',
    'secret',
    'private_key',
    'private_key_encrypted',
    'encrypted_private_key',
    'csr',
    'certificate',
    'csid',
    'compliance_csid',
    'production_csid',
    'compliance_secret',
    'production_secret',
    'xml',
    'signed_xml',
    'zatca_xml',
    'request_body',
    'raw_response'
  ]
$$;


ALTER FUNCTION "public"."audit_safe_metadata"("p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_storage_object_write_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bucket TEXT;
  v_name TEXT;
  v_tenant_id UUID;
  v_branch_id UUID;
  v_extension TEXT;
  v_path_shape TEXT;
BEGIN
  v_bucket := COALESCE(NEW.bucket_id, OLD.bucket_id);
  v_name := COALESCE(NEW.name, OLD.name);

  IF v_bucket NOT IN (
    'product-images',
    'branch-assets',
    'expense-receipts',
    'purchases-bills',
    'invoice-pdfs',
    'invoice-pdf',
    'invoice-pdfs-private'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_tenant_id := public.storage_path_uuid_segment(v_name, 1);
  v_branch_id := public.storage_path_uuid_segment(v_name, 2);

  IF v_bucket = 'branch-assets' THEN
    v_tenant_id := public.storage_branch_asset_tenant_id(v_name);
    v_branch_id := public.storage_branch_asset_branch_id(v_name);
  END IF;

  v_extension := lower(NULLIF(regexp_replace(v_name, '^.*\.', ''), v_name));
  v_path_shape := CASE
    WHEN public.storage_path_uuid_segment(v_name, 1) IS NOT NULL
      AND public.storage_path_uuid_segment(v_name, 2) IS NOT NULL THEN 'tenant_branch'
    WHEN public.storage_path_uuid_segment(v_name, 1) IS NOT NULL THEN 'tenant_or_branch_root'
    ELSE 'other'
  END;

  PERFORM public.record_audit_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'storage_object_uploaded' ELSE 'storage_object_deleted' END,
    v_tenant_id,
    v_branch_id,
    auth.uid(),
    NULL,
    'storage_object',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN v_bucket IN ('expense-receipts', 'purchases-bills') THEN 'info' ELSE 'debug' END,
    'succeeded',
    jsonb_build_object(
      'bucket_id', v_bucket,
      'operation', TG_OP,
      'path_shape', v_path_shape,
      'extension', v_extension
    ),
    NULL,
    NULL
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."audit_storage_object_write_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_user_profile_write_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'user_created';
  ELSIF OLD.role IS DISTINCT FROM NEW.role THEN
    v_action := 'user_role_changed';
  ELSIF OLD.branch_id IS DISTINCT FROM NEW.branch_id THEN
    v_action := 'user_branch_changed';
  ELSIF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    v_action := 'user_status_changed';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.record_audit_event(
    v_action,
    NEW.tenant_id,
    NEW.branch_id,
    auth.uid(),
    NULL,
    'user_profile',
    NEW.id,
    CASE WHEN v_action = 'user_role_changed' THEN 'warning' ELSE 'info' END,
    'succeeded',
    jsonb_build_object(
      'operation', TG_OP,
      'role', NEW.role::text,
      'previous_role', CASE WHEN TG_OP = 'UPDATE' THEN OLD.role::text ELSE NULL END,
      'is_active', NEW.is_active
    ),
    NULL,
    NULL
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_user_profile_write_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_create_branch"("p_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE((
    SELECT usage.can_create_branch
    FROM public.get_tenant_branch_usage(p_tenant_id) AS usage
    LIMIT 1
  ), FALSE)
$$;


ALTER FUNCTION "public"."can_create_branch"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_create_branch"("p_tenant_id" "uuid") IS 'Boolean helper for future branch creation enforcement.';



CREATE OR REPLACE FUNCTION "public"."can_manage_branch_login_username"("p_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.is_active IS TRUE
      AND (
        up.role::text = 'super_admin'
        OR (
          up.role::text = 'owner'
          AND up.tenant_id = p_tenant_id
        )
      )
  ), FALSE)
$$;


ALTER FUNCTION "public"."can_manage_branch_login_username"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_manage_branch_login_username"("p_tenant_id" "uuid") IS 'Returns true when the current authenticated user may manage branch username rows for the tenant.';



CREATE OR REPLACE FUNCTION "public"."cancel_purchase_receiving"("p_purchase_id" "uuid", "p_reason" "text", "p_confirm" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_movement RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_reversed_lines INTEGER := 0;
  v_reversed_quantity NUMERIC(12, 3) := 0;
  v_available_quantity NUMERIC(12, 3);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Cancel/reversal confirmation is required' USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'A cancellation or reversal reason is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-receiving:' || p_purchase_id::text, 0));

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN
    RAISE EXCEPTION 'Only receive-stock purchases can use this cancel/reversal flow.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('cancelled', 'reversed') THEN
    RAISE EXCEPTION 'This purchase receiving is already cancelled or reversed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('draft', 'pending_confirmation') THEN
    UPDATE public.purchase_items
    SET receiving_status = 'cancelled'
    WHERE purchase_id = v_purchase.id
      AND receiving_status = 'pending';

    UPDATE public.purchases
    SET receiving_status = 'cancelled',
        status = 'cancelled',
        cancelled_at = v_now,
        cancelled_by = v_user_id,
        cancellation_reason = v_reason,
        updated_at = v_now
    WHERE id = v_purchase.id;

    PERFORM public.record_audit_event(
      'purchase_receiving_cancelled',
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_user_id,
      v_profile.role,
      'purchase',
      v_purchase.id,
      'warning',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', v_purchase.purchase_mode,
        'receiving_status_before', v_purchase.receiving_status,
        'reason_length', length(v_reason),
        'stock_changed', false,
        'total_amount', v_purchase.total_amount
      ),
      NULL,
      NULL
    );

    RETURN jsonb_build_object(
      'ok', true,
      'purchase_id', v_purchase.id,
      'receiving_status', 'cancelled',
      'stock_changed', false
    );
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') <> 'confirmed' THEN
    RAISE EXCEPTION 'This purchase receiving is not confirmed and cannot be reversed.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id
      AND psm.reason = 'purchase_receiving_confirmed'
  ) THEN
    RAISE EXCEPTION 'This received purchase has no Phase 4C stock movement records. Use a manual inventory adjustment.'
      USING ERRCODE = '23514';
  END IF;

  FOR v_movement IN
    SELECT psm.*
    FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id
      AND psm.reason = 'purchase_receiving_confirmed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.purchase_stock_movements rev
        WHERE rev.reversal_of = psm.id
      )
    ORDER BY psm.created_at, psm.id
    FOR UPDATE
  LOOP
    SELECT ii.current_quantity
      INTO v_available_quantity
    FROM public.inventory_items ii
    WHERE ii.id = v_movement.inventory_item_id
      AND ii.tenant_id = v_purchase.tenant_id
      AND ii.branch_id = v_purchase.branch_id
    FOR UPDATE;

    IF v_available_quantity IS NULL THEN
      RAISE EXCEPTION 'Linked stock item was not found in this branch.'
        USING ERRCODE = '23514';
    END IF;

    IF v_available_quantity < v_movement.quantity_delta THEN
      RAISE EXCEPTION 'Cannot reverse receiving because current stock is lower than the received quantity.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.inventory_items
    SET current_quantity = current_quantity - v_movement.quantity_delta,
        updated_at = v_now
    WHERE id = v_movement.inventory_item_id;

    INSERT INTO public.purchase_stock_movements (
      tenant_id,
      branch_id,
      purchase_id,
      purchase_item_id,
      inventory_item_id,
      quantity_delta,
      unit_cost,
      reason,
      reversal_of,
      created_by,
      created_at
    ) VALUES (
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_purchase.id,
      v_movement.purchase_item_id,
      v_movement.inventory_item_id,
      -v_movement.quantity_delta,
      v_movement.unit_cost,
      'purchase_receiving_reversed',
      v_movement.id,
      v_user_id,
      v_now
    );

    UPDATE public.purchase_items
    SET receiving_status = 'reversed'
    WHERE id = v_movement.purchase_item_id;

    v_reversed_lines := v_reversed_lines + 1;
    v_reversed_quantity := v_reversed_quantity + v_movement.quantity_delta;
  END LOOP;

  IF v_reversed_lines = 0 THEN
    RAISE EXCEPTION 'This purchase receiving has already been reversed.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.purchases
  SET receiving_status = 'reversed',
      status = 'cancelled',
      reversed_at = v_now,
      reversed_by = v_user_id,
      reversal_reason = v_reason,
      updated_at = v_now
  WHERE id = v_purchase.id;

  PERFORM public.record_audit_event(
    'purchase_receiving_reversed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'warning',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'reversed_lines', v_reversed_lines,
      'reversed_quantity', v_reversed_quantity,
      'reason_length', length(v_reason),
      'total_amount', v_purchase.total_amount
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'receiving_status', 'reversed',
    'stock_changed', true,
    'reversed_lines', v_reversed_lines,
    'reversed_quantity', v_reversed_quantity
  );
END;
$$;


ALTER FUNCTION "public"."cancel_purchase_receiving"("p_purchase_id" "uuid", "p_reason" "text", "p_confirm" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cancel_purchase_receiving"("p_purchase_id" "uuid", "p_reason" "text", "p_confirm" boolean) IS 'Cancels pending purchase receiving or reverses confirmed Phase 4C receiving through stock movement reversal rows. Does not delete purchases or attachments.';



CREATE OR REPLACE FUNCTION "public"."close_register_session"("p_session_id" "uuid", "p_actual_cash" numeric, "p_closing_checks" "jsonb" DEFAULT NULL::"jsonb", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_scope RECORD;
  v_session RECORD;
  v_cash_total NUMERIC := 0;
  v_card_total NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_cash_expenses NUMERIC := 0;
  v_invoice_count INTEGER := 0;
  v_expected_cash NUMERIC := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Register session is required' USING ERRCODE = '22023';
  END IF;

  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Actual cash must be zero or greater' USING ERRCODE = '22023';
  END IF;

  IF p_closing_checks IS NOT NULL AND jsonb_typeof(p_closing_checks) <> 'object' THEN
    RAISE EXCEPTION 'Closing checks must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_session
  FROM public.pos_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register session not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(v_session.branch_id);

  IF v_session.tenant_id IS DISTINCT FROM v_scope.scope_tenant_id
     OR v_session.branch_id IS DISTINCT FROM v_scope.scope_branch_id
  THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Register session is already closed' USING ERRCODE = '23514';
  END IF;

  WITH inv AS (
    SELECT
      i.id,
      COALESCE(i.payment_method::text, 'other') AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.session_id = v_session.id
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  payment_rows AS (
    SELECT
      COALESCE(p.method::text, inv.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
        ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
      END AS signed_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0) AS total_expenses,
      COALESCE(SUM(CASE WHEN e.payment_method::text = 'cash' THEN COALESCE(e.total_paid, e.amount, 0) ELSE 0 END), 0) AS cash_expenses
    FROM public.expenses e
    WHERE e.session_id = v_session.id
  )
  SELECT
    COALESCE((SELECT COUNT(*)::integer FROM inv), 0),
    COALESCE((SELECT SUM(CASE WHEN method = 'cash' THEN signed_amount ELSE 0 END) FROM payment_rows), 0),
    COALESCE((SELECT SUM(CASE WHEN method = 'card' THEN signed_amount ELSE 0 END) FROM payment_rows), 0),
    COALESCE(exp.total_expenses, 0),
    COALESCE(exp.cash_expenses, 0)
  INTO
    v_invoice_count,
    v_cash_total,
    v_card_total,
    v_total_expenses,
    v_cash_expenses
  FROM exp;

  v_expected_cash := ROUND(COALESCE(v_session.opening_cash, 0) + v_cash_total - v_cash_expenses, 2);

  UPDATE public.pos_sessions
  SET
    closed_by = v_user_id,
    closed_at = NOW(),
    closing_cash_expected = v_expected_cash,
    closing_cash_actual = ROUND(p_actual_cash, 2),
    closing_cash_difference = ROUND(p_actual_cash, 2) - v_expected_cash,
    total_cash_sales = ROUND(v_cash_total, 2),
    total_card_sales = ROUND(v_card_total, 2),
    total_expenses = ROUND(v_total_expenses, 2),
    total_invoices = v_invoice_count,
    closing_checks = COALESCE(p_closing_checks, '{}'::jsonb),
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    status = 'closed'
  WHERE id = v_session.id;

  RETURN public.get_register_session_summary(v_session.branch_id, v_session.id) -> 'session';
END;
$$;


ALTER FUNCTION "public"."close_register_session"("p_session_id" "uuid", "p_actual_cash" numeric, "p_closing_checks" "jsonb", "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."close_register_session"("p_session_id" "uuid", "p_actual_cash" numeric, "p_closing_checks" "jsonb", "p_notes" "text") IS 'Phase 5C-5B verified Close Register RPC. Frontend parameter names: p_session_id, p_actual_cash, p_closing_checks, p_notes.';



CREATE OR REPLACE FUNCTION "public"."complete_onboarding"("p_company_name" "text", "p_company_name_ar" "text" DEFAULT ''::"text", "p_vat_number" "text" DEFAULT ''::"text", "p_cr_number" "text" DEFAULT ''::"text", "p_city" "text" DEFAULT ''::"text", "p_country" "text" DEFAULT 'SA'::"text", "p_phone" "text" DEFAULT ''::"text", "p_website" "text" DEFAULT ''::"text", "p_plan_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_plan_id   UUID;
BEGIN
  -- Idempotency guard
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND tenant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_ONBOARDED: user % already has a tenant', v_user_id;
  END IF;

  -- Resolve plan (fall back to cheapest active plan if none selected)
  IF p_plan_id IS NULL THEN
    SELECT id INTO v_plan_id
    FROM   public.subscription_plans
    WHERE  is_active = TRUE
    ORDER  BY price_monthly ASC
    LIMIT  1;
  ELSE
    v_plan_id := p_plan_id;
  END IF;

  -- 1. Create tenant
  INSERT INTO public.tenants (
    name, name_ar, vat_number, cr_number,
    city, country, phone, email
  ) VALUES (
    p_company_name,
    NULLIF(TRIM(p_company_name_ar), ''),
    NULLIF(TRIM(p_vat_number),      ''),
    NULLIF(TRIM(p_cr_number),       ''),
    NULLIF(TRIM(p_city),            ''),
    COALESCE(NULLIF(TRIM(p_country), ''), 'SA'),
    NULLIF(TRIM(p_phone),           ''),
    NULL
  )
  RETURNING id INTO v_tenant_id;

  -- 2. Create 14-day trial subscription
  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, starts_at, trial_ends_at
  ) VALUES (
    v_tenant_id,
    v_plan_id,
    'trial',
    NOW(),
    NOW() + INTERVAL '14 days'
  );

  -- 3. Promote user to owner — branch_id stays NULL.
  --    Branches are created manually via Settings → Branches.
  UPDATE public.user_profiles
  SET
    tenant_id  = v_tenant_id,
    branch_id  = NULL,
    role       = 'owner',
    updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('tenant_id', v_tenant_id);

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;


ALTER FUNCTION "public"."complete_onboarding"("p_company_name" "text", "p_company_name_ar" "text", "p_vat_number" "text", "p_cr_number" "text", "p_city" "text", "p_country" "text", "p_phone" "text", "p_website" "text", "p_plan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.purchase_date,
         p.purchase_mode, p.status, p.receiving_status
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to confirm this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to confirm this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to confirm this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') IN ('detailed_receiving', 'receive_stock')
     AND COALESCE(v_purchase.status, 'posted') = 'draft'
     AND COALESCE(v_purchase.receiving_status, 'not_applicable') = 'not_applicable'
  THEN
    UPDATE public.purchases
    SET receiving_status = 'pending_confirmation',
        updated_at = NOW()
    WHERE id = v_purchase.id;
  END IF;

  RETURN public.confirm_purchase_receiving_unchecked(p_purchase_id, p_confirm);
END;
$$;


ALTER FUNCTION "public"."confirm_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) IS 'User-facing Confirm Stock RPC. Enforces the 45-day window, normalizes draft/not_applicable stock rows to pending, then delegates to Phase 4C stock confirmation.';



CREATE OR REPLACE FUNCTION "public"."confirm_purchase_receiving_unchecked"("p_purchase_id" "uuid", "p_confirm" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_line RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_total_lines INTEGER := 0;
  v_stock_lines INTEGER := 0;
  v_skipped_lines INTEGER := 0;
  v_total_quantity NUMERIC(12, 3) := 0;
  v_inventory_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Receiving confirmation is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-receiving:' || p_purchase_id::text, 0));

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to receive this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to receive this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to receive this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN
    RAISE EXCEPTION 'Only receive-stock purchases can be confirmed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.status, 'posted') = 'cancelled' THEN
    RAISE EXCEPTION 'This purchase is cancelled and cannot be received.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') NOT IN ('draft', 'pending_confirmation') THEN
    IF v_purchase.receiving_status = 'confirmed' THEN
      RAISE EXCEPTION 'This purchase receiving has already been confirmed.'
        USING ERRCODE = '23514';
    END IF;

    RAISE EXCEPTION 'This purchase is not pending receiving confirmation.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id
      AND psm.reason = 'purchase_receiving_confirmed'
  ) THEN
    RAISE EXCEPTION 'This purchase receiving has already been confirmed.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_total_lines
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id;

  IF v_total_lines = 0 THEN
    RAISE EXCEPTION 'Add purchase item lines before confirming receiving.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_stock_lines
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id
    AND pi.inventory_item_id IS NOT NULL
    AND COALESCE(pi.line_type, 'stock') = 'stock'
    AND COALESCE(pi.quantity, 0) > 0;

  IF v_stock_lines = 0 THEN
    RAISE EXCEPTION 'At least one linked stock item is required before confirming receiving.'
      USING ERRCODE = '23514';
  END IF;

  v_stock_lines := 0;

  FOR v_line IN
    SELECT pi.*
    FROM public.purchase_items pi
    WHERE pi.purchase_id = v_purchase.id
    ORDER BY pi.created_at, pi.id
    FOR UPDATE
  LOOP
    IF COALESCE(v_line.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'Purchase line quantity must be greater than zero.'
        USING ERRCODE = '23514';
    END IF;

    IF v_line.inventory_item_id IS NOT NULL
       AND COALESCE(v_line.line_type, 'stock') = 'stock'
    THEN
      UPDATE public.inventory_items ii
      SET current_quantity = COALESCE(ii.current_quantity, 0) + v_line.quantity,
          unit_cost = CASE
            WHEN COALESCE(v_line.unit_cost, 0) > 0 THEN v_line.unit_cost
            ELSE ii.unit_cost
          END,
          updated_at = v_now
      WHERE ii.id = v_line.inventory_item_id
        AND ii.tenant_id = v_purchase.tenant_id
        AND ii.branch_id = v_purchase.branch_id
      RETURNING ii.id INTO v_inventory_id;

      IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'Linked stock item was not found in this branch.'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO public.purchase_stock_movements (
        tenant_id,
        branch_id,
        purchase_id,
        purchase_item_id,
        inventory_item_id,
        quantity_delta,
        unit_cost,
        reason,
        created_by,
        created_at
      ) VALUES (
        v_purchase.tenant_id,
        v_purchase.branch_id,
        v_purchase.id,
        v_line.id,
        v_line.inventory_item_id,
        v_line.quantity,
        v_line.unit_cost,
        'purchase_receiving_confirmed',
        v_user_id,
        v_now
      );

      UPDATE public.purchase_items
      SET receiving_status = 'confirmed',
          received_quantity = v_line.quantity,
          confirmed_at = v_now
      WHERE id = v_line.id;

      v_stock_lines := v_stock_lines + 1;
      v_total_quantity := v_total_quantity + v_line.quantity;
    ELSE
      UPDATE public.purchase_items
      SET receiving_status = 'skipped',
          received_quantity = 0,
          confirmed_at = v_now
      WHERE id = v_line.id;

      v_skipped_lines := v_skipped_lines + 1;
    END IF;
  END LOOP;

  UPDATE public.purchases
  SET receiving_status = 'confirmed',
      status = CASE WHEN status = 'draft' THEN 'posted' ELSE status END,
      received_at = v_now,
      received_by = v_user_id,
      updated_at = v_now
  WHERE id = v_purchase.id;

  PERFORM public.record_audit_event(
    'purchase_receiving_confirmed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'stock_lines_confirmed', v_stock_lines,
      'lines_skipped', v_skipped_lines,
      'total_quantity_received', v_total_quantity,
      'has_bill_number', v_purchase.bill_number IS NOT NULL,
      'total_amount', v_purchase.total_amount
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'receiving_status', 'confirmed',
    'stock_lines_confirmed', v_stock_lines,
    'lines_skipped', v_skipped_lines,
    'total_quantity_received', v_total_quantity
  );
END;
$$;


ALTER FUNCTION "public"."confirm_purchase_receiving_unchecked"("p_purchase_id" "uuid", "p_confirm" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_purchase_receiving_unchecked"("p_purchase_id" "uuid", "p_confirm" boolean) IS 'Confirms pending receive-stock purchases and increases inventory only for linked stock lines. Safe human confirmation path for future AI/OCR drafts.';



CREATE OR REPLACE FUNCTION "public"."consume_rate_limit"("p_action" "text", "p_scope" "text", "p_scope_id" "text", "p_max_attempts" integer, "p_window_seconds" integer, "p_tenant_id" "uuid" DEFAULT NULL::"uuid", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_actor_user_id" "uuid" DEFAULT NULL::"uuid", "p_actor_role" "text" DEFAULT NULL::"text", "p_target_type" "text" DEFAULT NULL::"text", "p_target_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_ip_hash" "text" DEFAULT NULL::"text", "p_request_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_action TEXT := NULLIF(TRIM(COALESCE(p_action, '')), '');
  v_scope TEXT := NULLIF(TRIM(COALESCE(p_scope, '')), '');
  v_scope_id TEXT := NULLIF(TRIM(COALESCE(p_scope_id, '')), '');
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_attempts INTEGER;
  v_allowed BOOLEAN;
  v_retry_after INTEGER;
BEGIN
  IF v_action IS NULL OR v_scope IS NULL OR v_scope_id IS NULL THEN
    RAISE EXCEPTION 'Rate limit action, scope, and scope_id are required' USING ERRCODE = '22023';
  END IF;

  IF p_max_attempts IS NULL OR p_max_attempts <= 0 THEN
    RAISE EXCEPTION 'Rate limit max_attempts must be positive' USING ERRCODE = '22023';
  END IF;

  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'Rate limit window_seconds must be positive' USING ERRCODE = '22023';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.security_rate_limits (
    action,
    scope,
    scope_id,
    tenant_id,
    branch_id,
    actor_user_id,
    target_type,
    target_id,
    window_start,
    window_seconds,
    max_attempts,
    attempts,
    first_seen_at,
    last_seen_at,
    metadata
  ) VALUES (
    v_action,
    v_scope,
    v_scope_id,
    p_tenant_id,
    p_branch_id,
    p_actor_user_id,
    NULLIF(TRIM(COALESCE(p_target_type, '')), ''),
    p_target_id,
    v_window_start,
    p_window_seconds,
    p_max_attempts,
    1,
    v_now,
    v_now,
    public.audit_safe_metadata(p_metadata)
  )
  ON CONFLICT (action, scope, scope_id, window_start, window_seconds)
  DO UPDATE SET
    attempts = public.security_rate_limits.attempts + 1,
    max_attempts = EXCLUDED.max_attempts,
    tenant_id = COALESCE(public.security_rate_limits.tenant_id, EXCLUDED.tenant_id),
    branch_id = COALESCE(public.security_rate_limits.branch_id, EXCLUDED.branch_id),
    actor_user_id = COALESCE(public.security_rate_limits.actor_user_id, EXCLUDED.actor_user_id),
    target_type = COALESCE(public.security_rate_limits.target_type, EXCLUDED.target_type),
    target_id = COALESCE(public.security_rate_limits.target_id, EXCLUDED.target_id),
    last_seen_at = EXCLUDED.last_seen_at,
    metadata = public.security_rate_limits.metadata || EXCLUDED.metadata
  RETURNING attempts INTO v_attempts;

  v_allowed := v_attempts <= p_max_attempts;
  v_retry_after := GREATEST(
    1,
    p_window_seconds - floor(extract(epoch FROM (v_now - v_window_start)))::integer
  );

  IF NOT v_allowed THEN
    PERFORM public.record_audit_event(
      'rate_limit_blocked',
      p_tenant_id,
      p_branch_id,
      p_actor_user_id,
      p_actor_role,
      p_target_type,
      p_target_id,
      'warning',
      'blocked',
      jsonb_build_object(
        'limited_action', v_action,
        'scope', v_scope,
        'attempts', v_attempts,
        'max_attempts', p_max_attempts,
        'window_seconds', p_window_seconds
      ) || public.audit_safe_metadata(p_metadata),
      p_ip_hash,
      p_request_id
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'action', v_action,
    'scope', v_scope,
    'scope_id', v_scope_id,
    'attempts', v_attempts,
    'max_attempts', p_max_attempts,
    'window_seconds', p_window_seconds,
    'retry_after_seconds', CASE WHEN v_allowed THEN 0 ELSE v_retry_after END
  );
END;
$$;


ALTER FUNCTION "public"."consume_rate_limit"("p_action" "text", "p_scope" "text", "p_scope_id" "text", "p_max_attempts" integer, "p_window_seconds" integer, "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_target_type" "text", "p_target_id" "uuid", "p_metadata" "jsonb", "p_ip_hash" "text", "p_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_branch_for_tenant"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
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

  IF v_profile.role NOT = 'owner' THEN
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


ALTER FUNCTION "public"."create_branch_for_tenant"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_branch_for_tenant"("p_payload" "jsonb") IS 'Creates a branch for the caller tenant after owner/admin authorization, manual suspension check, and active branch limit check.';



CREATE OR REPLACE FUNCTION "public"."create_full_credit_note"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_original RECORD;
  v_existing RECORD;
  v_original_invoice_id UUID;
  v_idempotency_key TEXT;
  v_items JSONB;
  v_payload JSONB := p_payload;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid credit note payload' USING ERRCODE = '22023';
  END IF;

  v_original_invoice_id := NULLIF(TRIM(COALESCE(p_payload ->> 'original_invoice_id', '')), '')::uuid;
  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');

  IF v_original_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Missing original invoice' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.tenant_id, i.branch_id, b.is_active AS branch_is_active
    INTO v_original
  FROM public.invoices i
  JOIN public.branches b ON b.id = i.branch_id
  WHERE i.id = v_original_invoice_id;

  IF NOT FOUND OR v_original.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Original invoice not found or branch inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_original.branch_id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to create credit notes' USING ERRCODE = '42501';
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT id, invoice_number, created_at, total_amount, zatca_status, payment_status
      INTO v_existing
    FROM public.invoices
    WHERE tenant_id = v_original.tenant_id
      AND branch_id = v_original.branch_id
      AND original_invoice_id = v_original.id
      AND credit_note_idempotency_key = v_idempotency_key
      AND zatca_invoice_type = 'credit_note'
      AND status <> 'cancelled';

    IF FOUND THEN
      RETURN jsonb_build_object(
        'credit_note_invoice_id', v_existing.id,
        'credit_note_invoice_number', v_existing.invoice_number,
        'created_at', v_existing.created_at,
        'total', v_existing.total_amount,
        'refund_status', COALESCE(v_existing.payment_status, 'refunded'),
        'zatca_status', v_existing.zatca_status,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'original_invoice_item_id', item.original_invoice_item_id,
        'quantity', item.remaining_quantity
      )
      ORDER BY item.original_invoice_item_id
    ),
    '[]'::jsonb
  )
    INTO v_items
  FROM public.get_invoice_refundable_items(v_original_invoice_id) item
  WHERE item.remaining_quantity > 0;

  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Invoice is already fully credited' USING ERRCODE = '23514';
  END IF;

  v_payload := jsonb_set(v_payload, '{items}', v_items, TRUE);

  RETURN public.create_partial_credit_note(v_payload);
END;
$$;


ALTER FUNCTION "public"."create_full_credit_note"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_full_credit_note"("p_payload" "jsonb") IS 'Compatibility wrapper that creates a credit note for all remaining refundable quantities using create_partial_credit_note.';



CREATE OR REPLACE FUNCTION "public"."create_full_credit_note_unchecked"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_original RECORD;
  v_existing RECORD;
  v_line RECORD;
  v_payment RECORD;
  v_branch_prefix TEXT;
  v_counter BIGINT;
  v_credit_note_id UUID := pg_catalog.gen_random_uuid();
  v_credit_note_number TEXT;
  v_original_invoice_id UUID;
  v_idempotency_key TEXT;
  v_reason TEXT;
  v_invoice_refund_method TEXT := 'other';
  v_payment_count INTEGER := 0;
  v_distinct_payment_methods INTEGER := 0;
  v_return_stock BOOLEAN := FALSE;
  v_open_session_id UUID;
  v_credit_payment_id UUID;
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
  ELSIF v_profile.role = 'owner' THEN
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

  SELECT
    COUNT(*)::integer,
    COUNT(DISTINCT method)::integer,
    CASE WHEN COUNT(DISTINCT method) = 1 THEN MIN(method::text) ELSE 'other' END
    INTO v_payment_count, v_distinct_payment_methods, v_invoice_refund_method
  FROM public.payments
  WHERE invoice_id = v_original.id
    AND COALESCE(amount, 0) > 0;

  IF v_payment_count = 0 THEN
    v_invoice_refund_method := 'other';
  END IF;

  IF v_invoice_refund_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
    v_invoice_refund_method := 'other';
  END IF;

  SELECT id
    INTO v_open_session_id
  FROM public.pos_sessions
  WHERE tenant_id = v_original.tenant_id
    AND branch_id = v_original.branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

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
      'refund_method', v_invoice_refund_method,
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
    session_id,
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
    v_open_session_id,
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
    v_invoice_refund_method::public.payment_method,
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

  IF v_payment_count > 0 THEN
    FOR v_payment IN
      SELECT id, method::text AS method, amount
      FROM public.payments
      WHERE invoice_id = v_original.id
        AND COALESCE(amount, 0) > 0
      ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    LOOP
      INSERT INTO public.payments (
        tenant_id,
        invoice_id,
        recorded_by,
        amount,
        amount_received,
        change_amount,
        method,
        notes,
        paid_at
      ) VALUES (
        v_original.tenant_id,
        v_credit_note_id,
        v_user_id,
        v_payment.amount,
        NULL,
        0,
        v_payment.method::public.payment_method,
        'Credit note refund reversal',
        v_created_at
      )
      RETURNING id INTO v_credit_payment_id;

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
        v_payment.id,
        v_payment.method::public.payment_method,
        v_payment.amount,
        v_reason,
        'completed',
        v_user_id,
        v_created_at
      );
    END LOOP;
  ELSE
    INSERT INTO public.payments (
      tenant_id,
      invoice_id,
      recorded_by,
      amount,
      amount_received,
      change_amount,
      method,
      notes,
      paid_at
    ) VALUES (
      v_original.tenant_id,
      v_credit_note_id,
      v_user_id,
      v_original.total_amount,
      NULL,
      0,
      'other',
      'Credit note refund reversal; original payment details unavailable',
      v_created_at
    )
    RETURNING id INTO v_credit_payment_id;

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
      NULL,
      'other',
      v_original.total_amount,
      v_reason,
      'completed',
      v_user_id,
      v_created_at
    );
  END IF;

  RETURN jsonb_build_object(
    'credit_note_invoice_id', v_credit_note_id,
    'credit_note_invoice_number', v_credit_note_number,
    'created_at', v_created_at,
    'total', v_original.total_amount,
    'refund_status', 'completed',
    'zatca_status', 'pending',
    'refund_method', v_invoice_refund_method,
    'idempotent_replay', false
  );
END;
$$;


ALTER FUNCTION "public"."create_full_credit_note_unchecked"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_full_credit_note_unchecked"("p_payload" "jsonb") IS 'Creates a full credit note/refund document for a posted reported or cleared invoice. Backend-controlled, idempotent, tenant/branch scoped.';



CREATE OR REPLACE FUNCTION "public"."create_partial_credit_note"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
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
  v_effective_return_stock BOOLEAN := FALSE;
  v_tenant_business_type TEXT := 'trading';
  v_items JSONB;
  v_item_count INTEGER := 0;
  v_invalid_count INTEGER := 0;
  v_conflict_name TEXT;
  v_created_at TIMESTAMPTZ := NOW();
  v_subtotal NUMERIC(12, 2) := 0;
  v_discount_amount NUMERIC(12, 2) := 0;
  v_tax_amount NUMERIC(12, 2) := 0;
  v_total_amount NUMERIC(12, 2) := 0;
  v_paid_total NUMERIC(12, 2) := 0;
  v_existing_refund_total NUMERIC(12, 2) := 0;
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
  v_items := p_payload -> 'items';

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

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one item to credit' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.tenant_id, i.branch_id, i.session_id, i.customer_id, i.invoice_number,
         i.zatca_invoice_type::text AS zatca_invoice_type,
         i.zatca_status::text AS zatca_status,
         i.status::text AS status,
         i.payment_status::text AS payment_status,
         i.payment_method::text AS payment_method,
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
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to create credit notes' USING ERRCODE = '42501';
  END IF;

  IF v_original.zatca_invoice_type NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'Only original invoices can be credited' USING ERRCODE = '22023';
  END IF;

  IF v_original.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled invoices cannot be credited' USING ERRCODE = '23514';
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

  PERFORM pg_advisory_xact_lock(hashtextextended('partial-credit-note:' || v_original.id::text, 0));

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
      'refund_status', COALESCE(v_existing.payment_status, 'refunded'),
      'zatca_status', v_existing.zatca_status,
      'idempotent_replay', true
    );
  END IF;

  DROP TABLE IF EXISTS pg_temp.partial_credit_request;
  CREATE TEMP TABLE pg_temp.partial_credit_request (
    original_invoice_item_id UUID,
    quantity NUMERIC(12, 3)
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.partial_credit_request (original_invoice_item_id, quantity)
  SELECT
    NULLIF(TRIM(item.original_invoice_item_id), '')::uuid,
    NULLIF(TRIM(item.quantity), '')::numeric
  FROM jsonb_to_recordset(v_items) AS item(
    original_invoice_item_id TEXT,
    quantity TEXT
  );

  SELECT COUNT(*) INTO v_item_count FROM pg_temp.partial_credit_request;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Select at least one item to credit' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.partial_credit_request
    WHERE original_invoice_item_id IS NULL
       OR quantity IS NULL
       OR quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Invalid returned quantity' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.partial_credit_request
    GROUP BY original_invoice_item_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate return item' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM pg_temp.partial_credit_request r
  LEFT JOIN public.invoice_items oi
    ON oi.id = r.original_invoice_item_id
   AND oi.invoice_id = v_original.id
  WHERE oi.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Returned item does not belong to the original invoice' USING ERRCODE = '42501';
  END IF;

  DROP TABLE IF EXISTS pg_temp.partial_credit_lines;
  CREATE TEMP TABLE pg_temp.partial_credit_lines ON COMMIT DROP AS
  WITH credited AS (
    SELECT
      ci.original_invoice_item_id,
      COALESCE(SUM(ci.quantity), 0) AS credited_quantity,
      COALESCE(SUM(ci.subtotal), 0) AS credited_subtotal,
      COALESCE(SUM(ci.discount_amount), 0) AS credited_discount_amount,
      COALESCE(SUM(ci.tax_amount), 0) AS credited_tax_amount,
      COALESCE(SUM(ci.total), 0) AS credited_total
    FROM public.invoice_items ci
    JOIN public.invoices cn ON cn.id = ci.invoice_id
    WHERE cn.original_invoice_id = v_original.id
      AND cn.zatca_invoice_type = 'credit_note'
      AND cn.status <> 'cancelled'
      AND ci.original_invoice_item_id IS NOT NULL
    GROUP BY ci.original_invoice_item_id
  ),
  base AS (
    SELECT
      oi.id AS original_invoice_item_id,
      oi.product_id,
      oi.name,
      oi.name_ar,
      oi.description,
      oi.sku,
      oi.unit,
      oi.quantity AS original_quantity,
      r.quantity AS return_quantity,
      oi.unit_price,
      oi.discount_percent,
      oi.discount_amount,
      oi.subtotal,
      oi.tax_rate,
      oi.tax_category,
      oi.tax_amount,
      oi.total,
      oi.sort_order,
      COALESCE(c.credited_quantity, 0) AS credited_quantity,
      GREATEST(oi.quantity - COALESCE(c.credited_quantity, 0), 0) AS remaining_quantity,
      GREATEST(oi.subtotal - COALESCE(c.credited_subtotal, 0), 0) AS remaining_subtotal,
      GREATEST(oi.discount_amount - COALESCE(c.credited_discount_amount, 0), 0) AS remaining_discount_amount,
      GREATEST(oi.tax_amount - COALESCE(c.credited_tax_amount, 0), 0) AS remaining_tax_amount,
      GREATEST(oi.total - COALESCE(c.credited_total, 0), 0) AS remaining_total,
      COALESCE(p.track_stock, FALSE) AS track_stock,
      COALESCE(p.is_service, FALSE) AS is_service
    FROM pg_temp.partial_credit_request r
    JOIN public.invoice_items oi
      ON oi.id = r.original_invoice_item_id
     AND oi.invoice_id = v_original.id
    LEFT JOIN credited c ON c.original_invoice_item_id = oi.id
    LEFT JOIN public.products p
      ON p.id = oi.product_id
     AND p.tenant_id = v_original.tenant_id
     AND p.branch_id = v_original.branch_id
  )
  SELECT
    base.*,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_subtotal
      ELSE LEAST(round(base.subtotal * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_subtotal)
    END AS return_subtotal,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_discount_amount
      ELSE LEAST(round(base.discount_amount * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_discount_amount)
    END AS return_discount_amount,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_tax_amount
      ELSE LEAST(round(base.tax_amount * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_tax_amount)
    END AS return_tax_amount,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_total
      ELSE LEAST(round(base.total * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_total)
    END AS return_total
  FROM base;

  SELECT name INTO v_conflict_name
  FROM pg_temp.partial_credit_lines
  WHERE return_quantity > remaining_quantity + 0.0005
     OR remaining_quantity <= 0
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Return quantity exceeds remaining refundable quantity for %', v_conflict_name
      USING ERRCODE = '23514';
  END IF;

  SELECT
    COALESCE(round(SUM(return_subtotal), 2), 0),
    COALESCE(round(SUM(return_discount_amount), 2), 0),
    COALESCE(round(SUM(return_tax_amount), 2), 0),
    COALESCE(round(SUM(return_total), 2), 0)
    INTO v_subtotal, v_discount_amount, v_tax_amount, v_total_amount
  FROM pg_temp.partial_credit_lines;

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Credit note total must be greater than zero' USING ERRCODE = '23514';
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

  SELECT COALESCE(round(SUM(amount), 2), 0)
    INTO v_paid_total
  FROM public.payments
  WHERE invoice_id = v_original.id;

  IF v_paid_total <= 0 THEN
    v_paid_total := COALESCE(v_original.total_amount, 0);
  END IF;

  SELECT COALESCE(round(SUM(amount), 2), 0)
    INTO v_existing_refund_total
  FROM public.payment_refunds
  WHERE original_invoice_id = v_original.id
    AND status <> 'failed';

  IF v_existing_refund_total + v_total_amount > v_paid_total + 0.01 THEN
    RAISE EXCEPTION 'Cumulative refunds cannot exceed the original payment total' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(t.business_type, 'trading')
    INTO v_tenant_business_type
  FROM public.tenants t
  WHERE t.id = v_original.tenant_id;

  v_effective_return_stock := v_return_stock AND COALESCE(v_tenant_business_type, 'trading') <> 'service';

  v_counter := public.get_next_credit_note_counter(v_original.branch_id);
  v_branch_prefix := COALESCE(NULLIF(TRIM(v_original.invoice_prefix), ''), 'INV');
  v_credit_note_number := v_branch_prefix || '-CN-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');

  INSERT INTO public.invoices (
    id,
    tenant_id,
    branch_id,
    session_id,
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
    v_original.session_id,
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
    v_subtotal,
    v_discount_amount,
    v_subtotal,
    v_tax_amount,
    v_total_amount,
    COALESCE(v_original.currency_code, 'SAR'),
    (v_created_at AT TIME ZONE 'Asia/Riyadh')::date,
    v_refund_method::public.payment_method,
    'posted',
    'refunded',
    v_reason,
    v_created_at
  );

  FOR v_line IN
    SELECT * FROM pg_temp.partial_credit_lines
    ORDER BY sort_order, original_invoice_item_id
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
      v_line.original_invoice_item_id,
      v_line.name,
      v_line.name_ar,
      v_line.description,
      v_line.sku,
      v_line.unit,
      v_line.return_quantity,
      v_line.unit_price,
      v_line.discount_percent,
      v_line.return_discount_amount,
      v_line.return_subtotal,
      v_line.tax_rate,
      v_line.tax_category,
      v_line.return_tax_amount,
      v_line.return_total,
      v_line.sort_order
    );

    IF v_effective_return_stock IS TRUE
       AND v_line.product_id IS NOT NULL
       AND COALESCE(v_line.track_stock, FALSE) IS TRUE
       AND COALESCE(v_line.is_service, FALSE) IS FALSE
    THEN
      UPDATE public.products
      SET stock_quantity = COALESCE(stock_quantity, 0) + v_line.return_quantity
      WHERE id = v_line.product_id
        AND tenant_id = v_original.tenant_id
        AND branch_id = v_original.branch_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock return failed for credited item' USING ERRCODE = '23514';
      END IF;

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
        v_line.return_quantity,
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
    v_total_amount,
    v_reason,
    'completed',
    v_user_id,
    v_created_at
  );

  RETURN jsonb_build_object(
    'credit_note_invoice_id', v_credit_note_id,
    'credit_note_invoice_number', v_credit_note_number,
    'created_at', v_created_at,
    'total', v_total_amount,
    'refund_status', 'completed',
    'refund_method', v_refund_method,
    'zatca_status', 'pending',
    'line_count', v_item_count,
    'idempotent_replay', false
  );
END;
$$;


ALTER FUNCTION "public"."create_partial_credit_note"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_partial_credit_note"("p_payload" "jsonb") IS 'Creates a partial item-level credit note for selected original invoice items. Backend-controlled, idempotent, tenant/branch scoped, concurrency-safe, and linked to the original register session.';



CREATE OR REPLACE FUNCTION "public"."create_partial_credit_note_with_refund"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_allocations JSONB := p_payload -> 'refund_allocations';
  v_legacy_payload JSONB;
  v_result JSONB;
  v_credit_note_id UUID;
  v_original_invoice_id UUID;
  v_tenant_id UUID;
  v_branch_id UUID;
  v_reason TEXT;
  v_total NUMERIC(12, 2);
  v_allocation_total NUMERIC(12, 2);
  v_allocation_count INTEGER;
  v_method TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR v_allocations IS NULL OR jsonb_typeof(v_allocations) <> 'array'
     OR jsonb_array_length(v_allocations) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'A cash/card refund allocation is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC)
    WHERE a.method NOT IN ('cash', 'card') OR a.amount IS NULL OR a.amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC)
    GROUP BY a.method HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Refund allocations must contain unique positive cash/card amounts' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*), ROUND(SUM(a.amount), 2)
    INTO v_allocation_count, v_allocation_total
  FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC);

  v_method := CASE
    WHEN v_allocation_count = 1 THEN v_allocations -> 0 ->> 'method'
    ELSE 'other'
  END;
  v_legacy_payload := jsonb_set(p_payload - 'refund_allocations', '{refund_method}', to_jsonb(v_method), TRUE);
  v_result := public.create_partial_credit_note(v_legacy_payload);
  v_credit_note_id := (v_result ->> 'credit_note_invoice_id')::UUID;
  v_total := ROUND((v_result ->> 'total')::NUMERIC, 2);

  IF ABS(v_allocation_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Refund allocation must equal the credit-note total' USING ERRCODE = '23514';
  END IF;

  -- Idempotent replay preserves the allocation written by the first call.
  IF COALESCE((v_result ->> 'idempotent_replay')::BOOLEAN, FALSE) THEN
    RETURN v_result;
  END IF;

  SELECT cn.original_invoice_id, cn.tenant_id, cn.branch_id, cn.credit_reason
    INTO v_original_invoice_id, v_tenant_id, v_branch_id, v_reason
  FROM public.invoices cn
  WHERE cn.id = v_credit_note_id
  FOR UPDATE;

  DELETE FROM public.payment_refunds WHERE credit_note_invoice_id = v_credit_note_id;

  INSERT INTO public.payment_refunds (
    tenant_id, branch_id, original_invoice_id, credit_note_invoice_id,
    payment_id, method, amount, reason, status, created_by, created_at
  )
  SELECT
    v_tenant_id, v_branch_id, v_original_invoice_id, v_credit_note_id,
    NULL, a.method::public.payment_method, ROUND(a.amount, 2), v_reason,
    'completed', v_user_id, NOW()
  FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC);

  INSERT INTO public.payments (
    tenant_id, invoice_id, recorded_by, amount, amount_received,
    change_amount, method, paid_at
  )
  SELECT
    v_tenant_id, v_credit_note_id, v_user_id, ROUND(a.amount, 2),
    ROUND(a.amount, 2), 0, a.method::public.payment_method, NOW()
  FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC);

  UPDATE public.invoices
  SET payment_method = v_method::public.payment_method
  WHERE id = v_credit_note_id;

  RETURN v_result || jsonb_build_object(
    'refund_method', CASE WHEN v_allocation_count = 2 THEN 'split' ELSE v_method END,
    'refund_allocations', v_allocations
  );
END;
$$;


ALTER FUNCTION "public"."create_partial_credit_note_with_refund"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_partial_credit_note_with_refund"("p_payload" "jsonb") IS 'Creates an atomic idempotent partial credit note with explicit cash/card refund allocation.';



CREATE OR REPLACE FUNCTION "public"."create_product_secure"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_scope RECORD;
  v_product_id UUID;
  v_branch_id UUID;
  v_branch_id_text TEXT;
  v_category_id UUID;
  v_category_id_text TEXT;
  v_name TEXT;
  v_sku TEXT;
  v_price NUMERIC(12, 2);
  v_sort_order INTEGER;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'branch_id',
      'name',
      'name_ar',
      'category_id',
      'description',
      'price',
      'vat_treatment',
      'image_url',
      'is_available',
      'sort_order',
      'sku',
      'notes',
      'is_service'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product field' USING ERRCODE = '22023';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Product name is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'price') OR jsonb_typeof(p_payload -> 'price') <> 'number' THEN
    RAISE EXCEPTION 'Product price must be a number' USING ERRCODE = '22023';
  END IF;
  v_price := (p_payload ->> 'price')::NUMERIC(12, 2);
  IF v_price < 0 THEN
    RAISE EXCEPTION 'Product price must be zero or higher' USING ERRCODE = '22023';
  END IF;

  v_branch_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '');
  IF v_branch_id_text IS NOT NULL THEN
    BEGIN
      v_branch_id := v_branch_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid branch id' USING ERRCODE = '22023';
    END;
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(v_branch_id);

  v_category_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'category_id', '')), '');
  IF v_category_id_text IS NOT NULL THEN
    BEGIN
      v_category_id := v_category_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid category id' USING ERRCODE = '22023';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = v_category_id
        AND c.tenant_id = v_scope.tenant_id
        AND c.branch_id = v_scope.branch_id
        AND c.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Product category does not belong to this branch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_payload ? 'sku' AND NULLIF(btrim(COALESCE(p_payload ->> 'sku', '')), '') IS NOT NULL THEN
    v_sku := public.normalize_product_sku(p_payload ->> 'sku');
  ELSE
    v_sku := public.next_product_sku(v_scope.tenant_id, v_name);
  END IF;

  v_sort_order := COALESCE(NULLIF(p_payload ->> 'sort_order', '')::INTEGER, 0);

  BEGIN
    INSERT INTO public.products (
      tenant_id,
      branch_id,
      name,
      name_ar,
      category_id,
      description,
      price,
      vat_treatment,
      image_url,
      is_available,
      sort_order,
      sku,
      notes,
      is_service
    ) VALUES (
      v_scope.tenant_id,
      v_scope.branch_id,
      v_name,
      NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), ''),
      v_category_id,
      NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), ''),
      v_price,
      COALESCE(NULLIF(p_payload ->> 'vat_treatment', ''), 'inherit'),
      NULLIF(btrim(COALESCE(p_payload ->> 'image_url', '')), ''),
      COALESCE((p_payload ->> 'is_available')::BOOLEAN, TRUE),
      v_sort_order,
      v_sku,
      NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), ''),
      COALESCE((p_payload ->> 'is_service')::BOOLEAN, FALSE)
    )
    RETURNING id, sku INTO v_product_id, v_sku;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SKU already exists for another product in this business'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product_id,
    'sku', v_sku,
    'tenant_id', v_scope.tenant_id,
    'branch_id', v_scope.branch_id
  );
END;
$$;


ALTER FUNCTION "public"."create_product_secure"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_product_secure"("p_payload" "jsonb") IS 'Creates a product or service with tenant-level normalized SKU validation/generation.';



CREATE OR REPLACE FUNCTION "public"."delete_purchase_bill"("p_purchase_id" "uuid", "p_confirm" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_item_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Deletion confirmation is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase bill not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase bill.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase bill.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to delete this purchase bill.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('simple_bill', 'bill_only') THEN
    RAISE EXCEPTION 'This purchase contains stock details. Use the purchase delete action.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_item_count
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id;

  IF v_item_count > 0 THEN
    RAISE EXCEPTION 'This purchase contains stock details. Use the purchase delete action.'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.purchases
  WHERE id = v_purchase.id;

  PERFORM public.record_audit_event(
    'purchase_bill_deleted',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'warning',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'status', v_purchase.status,
      'tax_input_mode', v_purchase.tax_input_mode,
      'payment_status', v_purchase.payment_status,
      'payment_method', v_purchase.payment_method,
      'has_bill_number', v_purchase.bill_number IS NOT NULL,
      'has_bill_url', v_purchase.bill_url IS NOT NULL,
      'attachment_cleanup_deferred', v_purchase.bill_url IS NOT NULL,
      'total_amount', v_purchase.total_amount,
      'purchase_date', v_purchase.purchase_date
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'attachment_cleanup_deferred', v_purchase.bill_url IS NOT NULL
  );
END;
$$;


ALTER FUNCTION "public"."delete_purchase_bill"("p_purchase_id" "uuid", "p_confirm" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_purchase_bill"("p_purchase_id" "uuid", "p_confirm" boolean) IS 'Safely deletes bill-only simple purchases with no item rows within the 45-day edit/delete window.';



CREATE OR REPLACE FUNCTION "public"."delete_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_result JSONB;
  v_stock_was_added BOOLEAN := FALSE;
  v_effective_receiving_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Deletion confirmation is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to delete this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN
    RAISE EXCEPTION 'Only receive-stock purchases use this delete action.'
      USING ERRCODE = '23514';
  END IF;

  v_effective_receiving_status := COALESCE(v_purchase.receiving_status, 'not_applicable');

  IF v_effective_receiving_status = 'not_applicable'
     AND COALESCE(v_purchase.status, 'posted') = 'draft'
  THEN
    UPDATE public.purchases
    SET receiving_status = 'pending_confirmation',
        updated_at = NOW()
    WHERE id = v_purchase.id;

    v_effective_receiving_status := 'pending_confirmation';
  END IF;

  IF v_effective_receiving_status NOT IN ('draft', 'pending_confirmation', 'confirmed') THEN
    RAISE EXCEPTION 'This purchase is already deleted or cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  v_stock_was_added := v_effective_receiving_status = 'confirmed';

  SELECT public.cancel_purchase_receiving(
    p_purchase_id,
    'Deleted from purchase history',
    TRUE
  ) INTO v_result;

  PERFORM public.record_audit_event(
    'purchase_receiving_deleted_or_reversed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'warning',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'receiving_status_before', v_purchase.receiving_status,
      'receiving_status_effective', v_effective_receiving_status,
      'stock_was_added', v_stock_was_added,
      'total_amount', v_purchase.total_amount
    ),
    NULL,
    NULL
  );

  RETURN v_result || jsonb_build_object(
    'deleted', true,
    'stock_was_added', v_stock_was_added
  );
END;
$$;


ALTER FUNCTION "public"."delete_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) IS 'User-facing Delete action for receive-stock purchases. Cancels pending receiving or safely reverses confirmed receiving within 45 days; treats draft/not_applicable stock rows as pending.';



CREATE OR REPLACE FUNCTION "public"."enforce_branch_creation_limit_and_suspension"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
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


ALTER FUNCTION "public"."enforce_branch_creation_limit_and_suspension"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_branch_creation_limit_and_suspension"() IS 'Blocks branch creation/activation when a tenant is manually suspended or has reached max_branches.';



CREATE OR REPLACE FUNCTION "public"."fn_purchase_item_update_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.inventory_item_id IS NOT NULL THEN
    UPDATE public.inventory_items
       SET current_quantity = current_quantity + NEW.quantity,
           updated_at       = NOW()
     WHERE id = NEW.inventory_item_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_purchase_item_update_stock"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_purchase_item_update_stock"() IS 'Legacy automatic purchase item stock trigger function. Phase 4C drops its trigger; stock receiving now goes through confirm_purchase_receiving.';



CREATE OR REPLACE FUNCTION "public"."get_branch_dashboard_recent_invoices"("p_branch_id" "uuid", "p_limit" integer DEFAULT 6) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 6), 1), 50);
  v_rows JSONB := '[]'::jsonb;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  IF v_scope.scope_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '42501';
  END IF;

  WITH rows AS (
    SELECT
      i.id,
      i.invoice_number,
      COALESCE(c.name, 'Walk-in Customer') AS customer_name,
      i.total_amount,
      CASE
        WHEN i.zatca_invoice_type::text = 'credit_note'
          THEN -1 * COALESCE(i.total_amount, 0)
        ELSE COALESCE(i.total_amount, 0)
      END AS display_total,
      i.status::text AS status,
      i.invoice_date,
      i.zatca_invoice_type::text AS document_type,
      i.created_at
    FROM public.invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.branch_id = v_scope.scope_branch_id
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
    ORDER BY i.created_at DESC
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'invoiceNumber', invoice_number,
      'customerName', customer_name,
      'totalAmount', total_amount,
      'displayTotal', display_total,
      'status', status,
      'invoiceDate', invoice_date,
      'documentType', document_type,
      'createdAt', created_at
    )
    ORDER BY created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM rows;

  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."get_branch_dashboard_recent_invoices"("p_branch_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_branch_dashboard_recent_invoices"("p_branch_id" "uuid", "p_limit" integer) IS 'Safe branch dashboard recent posted invoices and credit notes.';



CREATE OR REPLACE FUNCTION "public"."get_customer_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_total_count INTEGER := 0;
  v_new_this_period INTEGER := 0;
  v_individual_count INTEGER := 0;
  v_business_count INTEGER := 0;
  v_total_revenue NUMERIC := 0;
  v_top_customers JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE c.created_at::date BETWEEN p_start_date AND p_end_date)::integer,
    COUNT(*) FILTER (WHERE COALESCE(c.customer_type, 'individual') = 'individual')::integer,
    COUNT(*) FILTER (WHERE COALESCE(c.customer_type, 'individual') = 'business')::integer
  INTO v_total_count, v_new_this_period, v_individual_count, v_business_count
  FROM public.customers c
  WHERE c.tenant_id = v_scope.scope_tenant_id
    AND c.is_active IS TRUE;

  SELECT COALESCE(SUM(i.signed_total_amount), 0)
    INTO v_total_revenue
  FROM public.reporting_invoice_documents_v i
  WHERE i.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
    AND i.invoice_date BETWEEN p_start_date AND p_end_date
    AND i.is_counted IS TRUE;

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
      AND customer_id IS NOT NULL
  ),
  rows AS (
    SELECT
      c.id,
      COALESCE(c.name, 'Unknown') AS name,
      COALESCE(c.customer_type, 'individual') AS type,
      COALESCE(SUM(inv.signed_total_amount), 0) AS total_spent,
      COUNT(*)::integer AS order_count,
      MAX(inv.invoice_date)::text AS last_purchase
    FROM inv
    JOIN public.customers c ON c.id = inv.customer_id
    GROUP BY c.id, c.name, c.customer_type
    ORDER BY total_spent DESC
    LIMIT 15
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'type', type,
      'totalSpent', total_spent,
      'orderCount', order_count,
      'lastPurchase', last_purchase
    )
    ORDER BY total_spent DESC
  ), '[]'::jsonb)
  INTO v_top_customers
  FROM rows;

  RETURN jsonb_build_object(
    'totalCount', v_total_count,
    'newThisPeriod', v_new_this_period,
    'individualCount', v_individual_count,
    'businessCount', v_business_count,
    'totalRevenue', v_total_revenue,
    'topCustomers', v_top_customers
  );
END;
$$;


ALTER FUNCTION "public"."get_customer_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_customer_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") IS 'Safe customer summary where credit notes reduce customer spend.';



CREATE OR REPLACE FUNCTION "public"."get_dashboard_summary"("p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_start_date DATE := COALESCE(p_start_date, CURRENT_DATE);
  v_end_date DATE := COALESCE(p_end_date, COALESCE(p_start_date, CURRENT_DATE));
  v_total_sales NUMERIC := 0;
  v_total_count INTEGER := 0;
  v_total_cash NUMERIC := 0;
  v_total_card NUMERIC := 0;
  v_total_vat NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  v_branch_stats JSONB := '[]'::jsonb;
BEGIN
  IF v_start_date > v_end_date THEN
    RAISE EXCEPTION 'Invalid dashboard date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH inv AS (
    SELECT
      i.id,
      i.branch_id,
      i.payment_method::text AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount,
      COALESCE(i.tax_amount, 0) AS tax_amount
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  )
  SELECT
    COALESCE(SUM(accounting_sign * total_amount), 0),
    COUNT(*)::integer,
    COALESCE(SUM(accounting_sign * tax_amount), 0)
  INTO v_total_sales, v_total_count, v_total_vat
  FROM inv;

  WITH inv AS (
    SELECT
      i.id,
      i.payment_method::text AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  payment_rows AS (
    SELECT
      COALESCE(p.method::text, inv.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
        ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
      END AS signed_payment_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  )
  SELECT
    COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_payment_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'card' THEN signed_payment_amount ELSE 0 END), 0)
  INTO v_total_cash, v_total_card
  FROM payment_rows;

  SELECT COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0)
    INTO v_total_expenses
  FROM public.expenses e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN v_start_date AND v_end_date;

  WITH days AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval)::date AS day
  ),
  rows AS (
    SELECT
      d.day::text AS report_date,
      COALESCE(SUM(
        CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END
        * COALESCE(i.total_amount, 0)
      ), 0) AS sales_amount
    FROM days d
    LEFT JOIN public.invoices i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date = d.day
     AND i.status::text = 'posted'
     AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
    GROUP BY d.day
    ORDER BY d.day
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', report_date,
      'sales', sales_amount,
      'report_date', report_date,
      'sales_amount', sales_amount
    )
    ORDER BY report_date
  ), '[]'::jsonb)
  INTO v_daily_sales
  FROM rows;

  WITH scoped_branches AS (
    SELECT b.*
    FROM public.branches b
    WHERE b.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR b.id = v_scope.scope_branch_id)
  ),
  inv AS (
    SELECT
      i.id,
      i.branch_id,
      i.payment_method::text AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  branch_invoice_totals AS (
    SELECT
      branch_id,
      COALESCE(SUM(accounting_sign * total_amount), 0) AS today_sales,
      COUNT(*)::integer AS invoice_count
    FROM inv
    GROUP BY branch_id
  ),
  branch_payment_totals AS (
    SELECT
      inv.branch_id,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.invoice_payment_method, 'other') = 'cash'
          THEN CASE
            WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
            ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
          END
        ELSE 0
      END), 0) AS cash_total,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.invoice_payment_method, 'other') = 'card'
          THEN CASE
            WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
            ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
          END
        ELSE 0
      END), 0) AS card_total
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
    GROUP BY inv.branch_id
  ),
  open_sessions AS (
    SELECT branch_id, MIN(opened_at) AS opened_at
    FROM public.pos_sessions
    WHERE tenant_id = v_scope.scope_tenant_id
      AND status = 'open'
    GROUP BY branch_id
  ),
  production_status AS (
    SELECT DISTINCT ON (branch_id)
      branch_id,
      onboarding_status,
      connected_at,
      disconnected_at,
      updated_at
    FROM public.zatca_production_credentials
    WHERE tenant_id = v_scope.scope_tenant_id
      AND environment = 'production'
    ORDER BY branch_id, updated_at DESC NULLS LAST
  ),
  rows AS (
    SELECT
      b.id AS branch_id,
      b.name AS branch_name,
      b.logo_url,
      b.is_active,
      b.is_main_branch,
      COALESCE(b.zatca_phase, 1) AS zatca_phase,
      COALESCE(bit.today_sales, 0) AS today_sales,
      COALESCE(bit.invoice_count, 0) AS invoice_count,
      COALESCE(bpt.cash_total, 0) AS cash_total,
      COALESCE(bpt.card_total, 0) AS card_total,
      os.opened_at IS NOT NULL AS session_open,
      os.opened_at AS session_opened_at,
      CASE
        WHEN COALESCE(b.zatca_phase, 1) >= 2 THEN jsonb_build_object(
          'ok', COALESCE(ps.onboarding_status = 'production_connected', FALSE),
          'branchId', b.id,
          'branch_id', b.id,
          'environment', 'production',
          'onboardingStatus', COALESCE(ps.onboarding_status, 'not_started'),
          'onboarding_status', COALESCE(ps.onboarding_status, 'not_started'),
          'connectedAt', ps.connected_at,
          'connected_at', ps.connected_at,
          'disconnectedAt', ps.disconnected_at,
          'disconnected_at', ps.disconnected_at,
          'updatedAt', ps.updated_at,
          'updated_at', ps.updated_at
        )
        ELSE NULL
      END AS production_status
    FROM scoped_branches b
    LEFT JOIN branch_invoice_totals bit ON bit.branch_id = b.id
    LEFT JOIN branch_payment_totals bpt ON bpt.branch_id = b.id
    LEFT JOIN open_sessions os ON os.branch_id = b.id
    LEFT JOIN production_status ps ON ps.branch_id = b.id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', branch_id,
      'branch_id', branch_id,
      'name', branch_name,
      'branch_name', branch_name,
      'logo_url', logo_url,
      'is_active', is_active,
      'is_main_branch', is_main_branch,
      'zatca_phase', zatca_phase,
      'todaySales', today_sales,
      'today_sales', today_sales,
      'todayCount', invoice_count,
      'invoice_count', invoice_count,
      'todayCash', cash_total,
      'cash_total', cash_total,
      'todayCard', card_total,
      'card_total', card_total,
      'sessionOpen', session_open,
      'session_open', session_open,
      'sessionOpenedAt', session_opened_at,
      'session_opened_at', session_opened_at,
      'metricsAvailable', TRUE,
      'metrics_available', TRUE,
      'productionStatusReadable', TRUE,
      'production_status_readable', TRUE,
      'productionStatus', production_status,
      'production_status', production_status
    )
    ORDER BY is_main_branch DESC, branch_name
  ), '[]'::jsonb)
  INTO v_branch_stats
  FROM rows;

  RETURN jsonb_build_object(
    'totalSales', v_total_sales,
    'total_sales', v_total_sales,
    'totalCount', v_total_count,
    'total_invoices', v_total_count,
    'totalCash', v_total_cash,
    'cash_total', v_total_cash,
    'totalCard', v_total_card,
    'card_total', v_total_card,
    'totalVat', v_total_vat,
    'vat_collected', v_total_vat,
    'totalExpenses', v_total_expenses,
    'expenses_total', v_total_expenses,
    'dailySales', v_daily_sales,
    'daily_sales', v_daily_sales,
    'branchStats', v_branch_stats,
    'branch_stats', v_branch_stats
  );
END;
$$;


ALTER FUNCTION "public"."get_dashboard_summary"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_dashboard_summary"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") IS 'Dashboard KPI summary using direct posted invoice/payment/expense aggregation. Credit notes are signed negative; payment rows use ABS(amount) with invoice sign to avoid double-negative reversals.';



CREATE OR REPLACE FUNCTION "public"."get_expense_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_month_count INTEGER := 0;
  v_monthly_fixed NUMERIC := 0;
  v_total_fixed NUMERIC := 0;
  v_total_variable NUMERIC := 0;
  v_cat_bars JSONB := '[]'::jsonb;
  v_log JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT COUNT(*)::integer
    INTO v_month_count
  FROM generate_series(
    date_trunc('month', p_start_date)::date,
    date_trunc('month', p_end_date)::date,
    '1 month'::interval
  );

  SELECT COALESCE(SUM(monthly_amount), 0)
    INTO v_monthly_fixed
  FROM public.fixed_expenses f
  WHERE f.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR f.branch_id = v_scope.scope_branch_id)
    AND f.is_active IS TRUE;

  v_total_fixed := v_monthly_fixed * GREATEST(v_month_count, 0);

  SELECT COALESCE(SUM(total_paid), 0)
    INTO v_total_variable
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN p_start_date AND p_end_date;

  WITH rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS name,
      COALESCE(SUM(e.total_paid), 0) AS value,
      COALESCE(c.color, '#6b7280') AS color
    FROM public.reporting_expenses_v e
    LEFT JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    GROUP BY COALESCE(c.name, 'Uncategorized'), COALESCE(c.color, '#6b7280')
    UNION ALL
    SELECT 'Fixed Costs', v_total_fixed, '#6366f1'
    WHERE v_total_fixed > 0
  ),
  ranked AS (
    SELECT * FROM rows ORDER BY value DESC LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'value', value, 'color', color)
    ORDER BY value DESC
  ), '[]'::jsonb)
  INTO v_cat_bars
  FROM ranked;

  WITH rows AS (
    SELECT
      e.expense_date::text AS date,
      e.description,
      COALESCE(c.name, '—') AS category,
      e.total_paid AS amount,
      e.payment_method AS method
    FROM public.reporting_expenses_v e
    LEFT JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    ORDER BY e.expense_date DESC, e.created_at DESC
    LIMIT 200
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', date,
      'description', description,
      'category', category,
      'amount', amount,
      'method', method
    )
    ORDER BY date DESC
  ), '[]'::jsonb)
  INTO v_log
  FROM rows;

  RETURN jsonb_build_object(
    'totalVariable', v_total_variable,
    'totalFixed', v_total_fixed,
    'grandTotal', v_total_variable + v_total_fixed,
    'catBars', v_cat_bars,
    'log', v_log,
    'monthlyFixed', v_monthly_fixed
  );
END;
$$;


ALTER FUNCTION "public"."get_expense_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_expense_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") IS 'Safe expense summary using total_paid as actual cash/bank/card movement.';



CREATE OR REPLACE FUNCTION "public"."get_invoice_refundable_items"("p_invoice_id" "uuid") RETURNS TABLE("original_invoice_item_id" "uuid", "name" "text", "name_ar" "text", "sku" "text", "unit" "text", "product_id" "uuid", "original_quantity" numeric, "credited_quantity" numeric, "remaining_quantity" numeric, "unit_price" numeric, "subtotal" numeric, "discount_amount" numeric, "tax_rate" numeric, "tax_amount" numeric, "total" numeric, "credited_subtotal" numeric, "credited_discount_amount" numeric, "credited_tax_amount" numeric, "credited_total" numeric, "remaining_subtotal" numeric, "remaining_discount_amount" numeric, "remaining_tax_amount" numeric, "remaining_total" numeric, "track_stock" boolean, "is_service" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_original RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Missing original invoice' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.tenant_id, i.branch_id, i.zatca_invoice_type::text AS zatca_invoice_type,
         i.status::text AS status, i.zatca_status::text AS zatca_status,
         b.is_active AS branch_is_active
    INTO v_original
  FROM public.invoices i
  JOIN public.branches b ON b.id = i.branch_id
  WHERE i.id = p_invoice_id;

  IF NOT FOUND OR v_original.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Original invoice not found or branch inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_original.branch_id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to create credit notes' USING ERRCODE = '42501';
  END IF;

  IF v_original.zatca_invoice_type NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'Only original invoices can be credited' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH credited AS (
    SELECT
      ci.original_invoice_item_id,
      COALESCE(SUM(ci.quantity), 0) AS credited_quantity,
      COALESCE(SUM(ci.subtotal), 0) AS credited_subtotal,
      COALESCE(SUM(ci.discount_amount), 0) AS credited_discount_amount,
      COALESCE(SUM(ci.tax_amount), 0) AS credited_tax_amount,
      COALESCE(SUM(ci.total), 0) AS credited_total
    FROM public.invoice_items ci
    JOIN public.invoices cn ON cn.id = ci.invoice_id
    WHERE cn.original_invoice_id = v_original.id
      AND cn.zatca_invoice_type = 'credit_note'
      AND cn.status <> 'cancelled'
      AND ci.original_invoice_item_id IS NOT NULL
    GROUP BY ci.original_invoice_item_id
  )
  SELECT
    oi.id AS original_invoice_item_id,
    oi.name::text,
    oi.name_ar::text,
    oi.sku::text,
    oi.unit::text,
    oi.product_id,
    oi.quantity AS original_quantity,
    COALESCE(c.credited_quantity, 0) AS credited_quantity,
    GREATEST(oi.quantity - COALESCE(c.credited_quantity, 0), 0) AS remaining_quantity,
    oi.unit_price,
    oi.subtotal,
    oi.discount_amount,
    oi.tax_rate,
    oi.tax_amount,
    oi.total,
    COALESCE(c.credited_subtotal, 0) AS credited_subtotal,
    COALESCE(c.credited_discount_amount, 0) AS credited_discount_amount,
    COALESCE(c.credited_tax_amount, 0) AS credited_tax_amount,
    COALESCE(c.credited_total, 0) AS credited_total,
    GREATEST(oi.subtotal - COALESCE(c.credited_subtotal, 0), 0) AS remaining_subtotal,
    GREATEST(oi.discount_amount - COALESCE(c.credited_discount_amount, 0), 0) AS remaining_discount_amount,
    GREATEST(oi.tax_amount - COALESCE(c.credited_tax_amount, 0), 0) AS remaining_tax_amount,
    GREATEST(oi.total - COALESCE(c.credited_total, 0), 0) AS remaining_total,
    COALESCE(p.track_stock, FALSE) AS track_stock,
    COALESCE(p.is_service, FALSE) AS is_service
  FROM public.invoice_items oi
  LEFT JOIN credited c ON c.original_invoice_item_id = oi.id
  LEFT JOIN public.products p
    ON p.id = oi.product_id
   AND p.tenant_id = v_original.tenant_id
   AND p.branch_id = v_original.branch_id
  WHERE oi.invoice_id = v_original.id
  ORDER BY oi.sort_order, oi.created_at, oi.id;
END;
$$;


ALTER FUNCTION "public"."get_invoice_refundable_items"("p_invoice_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_invoice_refundable_items"("p_invoice_id" "uuid") IS 'Returns per-line remaining refundable quantity and amounts for an original invoice, scoped to the authenticated tenant/branch.';



CREATE OR REPLACE FUNCTION "public"."get_my_branch_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT up.branch_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_my_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT up.role
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT up.tenant_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_my_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_credit_note_counter"("p_branch_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_next_credit_note_counter"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_invoice_counter"("p_branch_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_counter BIGINT;
BEGIN
    UPDATE branches
    SET    invoice_counter = invoice_counter + 1
    WHERE  id = p_branch_id
    RETURNING invoice_counter INTO v_counter;
    RETURN v_counter;
END;
$$;


ALTER FUNCTION "public"."get_next_invoice_counter"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_zatca_counter"("p_branch_id" "uuid", "p_env" character varying DEFAULT 'sandbox'::character varying) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_counter BIGINT;
BEGIN
    UPDATE zatca_certificates
    SET    invoice_counter = invoice_counter + 1
    WHERE  branch_id = p_branch_id AND environment = p_env
    RETURNING invoice_counter INTO v_counter;
    RETURN v_counter;
END;
$$;


ALTER FUNCTION "public"."get_next_zatca_counter"("p_branch_id" "uuid", "p_env" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profit_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_month_count INTEGER := 0;
  v_monthly_fixed NUMERIC := 0;
  v_fixed_total NUMERIC := 0;
  v_gross_sales NUMERIC := 0;
  v_credit_notes NUMERIC := 0;
  v_total_revenue NUMERIC := 0;
  v_purchase_costs NUMERIC := 0;
  v_variable_expenses NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_monthly_rows JSONB := '[]'::jsonb;
  v_expense_by_cat JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT COUNT(*)::integer
    INTO v_month_count
  FROM generate_series(
    date_trunc('month', p_start_date)::date,
    date_trunc('month', p_end_date)::date,
    '1 month'::interval
  );

  SELECT COALESCE(SUM(monthly_amount), 0)
    INTO v_monthly_fixed
  FROM public.fixed_expenses f
  WHERE f.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR f.branch_id = v_scope.scope_branch_id)
    AND f.is_active IS TRUE;

  v_fixed_total := v_monthly_fixed * GREATEST(v_month_count, 0);

  SELECT
    COALESCE(SUM(gross_total_amount), 0),
    COALESCE(SUM(credited_total_amount), 0),
    COALESCE(SUM(signed_total_amount), 0)
  INTO v_gross_sales, v_credit_notes, v_total_revenue
  FROM public.reporting_invoice_documents_v i
  WHERE i.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
    AND i.invoice_date BETWEEN p_start_date AND p_end_date
    AND i.is_counted IS TRUE;

  SELECT COALESCE(SUM(subtotal), 0)
    INTO v_purchase_costs
  FROM public.reporting_counted_purchases_v p
  WHERE p.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
    AND p.purchase_date BETWEEN p_start_date AND p_end_date
    AND p.is_counted IS TRUE;

  SELECT COALESCE(SUM(profit_expense_amount), 0)
    INTO v_variable_expenses
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN p_start_date AND p_end_date;

  v_total_expenses := v_variable_expenses + v_fixed_total;

  WITH months AS (
    SELECT generate_series(
      date_trunc('month', p_start_date)::date,
      date_trunc('month', p_end_date)::date,
      '1 month'::interval
    )::date AS month_start
  ),
  rows AS (
    SELECT
      to_char(m.month_start, 'YYYY-MM') AS month,
      COALESCE(SUM(i.gross_total_amount), 0) AS gross_sales,
      COALESCE(SUM(i.credited_total_amount), 0) AS credit_notes,
      COALESCE(SUM(i.signed_total_amount), 0) AS revenue,
      COALESCE((
        SELECT SUM(p.subtotal)
        FROM public.reporting_counted_purchases_v p
        WHERE p.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
          AND p.purchase_date >= m.month_start
          AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
          AND p.purchase_date BETWEEN p_start_date AND p_end_date
          AND p.is_counted IS TRUE
      ), 0) AS purchase_cost,
      COALESCE((
        SELECT SUM(e.profit_expense_amount)
        FROM public.reporting_expenses_v e
        WHERE e.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
          AND e.expense_date >= m.month_start
          AND e.expense_date < (m.month_start + INTERVAL '1 month')::date
          AND e.expense_date BETWEEN p_start_date AND p_end_date
      ), 0) + v_monthly_fixed AS expenses
    FROM months m
    LEFT JOIN public.reporting_invoice_documents_v i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date >= m.month_start
     AND i.invoice_date < (m.month_start + INTERVAL '1 month')::date
     AND i.invoice_date BETWEEN p_start_date AND p_end_date
     AND i.is_counted IS TRUE
    GROUP BY m.month_start
    ORDER BY m.month_start
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', month,
      'grossSales', gross_sales,
      'creditNotes', credit_notes,
      'revenue', revenue,
      'cogs', purchase_cost,
      'grossProfit', revenue - purchase_cost,
      'expenses', expenses,
      'netProfit', revenue - purchase_cost - expenses
    )
    ORDER BY month
  ), '[]'::jsonb)
  INTO v_monthly_rows
  FROM rows;

  WITH rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS name,
      COALESCE(SUM(e.profit_expense_amount), 0) AS value
    FROM public.reporting_expenses_v e
    LEFT JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    GROUP BY COALESCE(c.name, 'Uncategorized')
    UNION ALL
    SELECT 'Fixed Costs', v_fixed_total
    WHERE v_fixed_total > 0
  ),
  ranked AS (
    SELECT * FROM rows ORDER BY value DESC LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'value', value)
    ORDER BY value DESC
  ), '[]'::jsonb)
  INTO v_expense_by_cat
  FROM ranked;

  RETURN jsonb_build_object(
    'reportLabel', 'Simple Profit Estimate',
    'grossSales', v_gross_sales,
    'creditNotes', v_credit_notes,
    'totalRevenue', v_total_revenue,
    'totalCOGS', v_purchase_costs,
    'grossProfit', v_total_revenue - v_purchase_costs,
    'totalExpenses', v_total_expenses,
    'netProfit', v_total_revenue - v_purchase_costs - v_total_expenses,
    'margin', CASE WHEN v_total_revenue <> 0 THEN ROUND(((v_total_revenue - v_purchase_costs - v_total_expenses) / v_total_revenue) * 100, 2) ELSE 0 END,
    'monthlyRows', v_monthly_rows,
    'expenseByCat', v_expense_by_cat,
    'purchaseCostLabel', 'Purchase-period cost estimate'
  );
END;
$$;


ALTER FUNCTION "public"."get_profit_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_profit_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") IS 'Simple profit estimate using net sales, counted purchase subtotal, and expense estimates. Not true inventory COGS.';



CREATE OR REPLACE FUNCTION "public"."get_purchase_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_total_purchased NUMERIC := 0;
  v_total_vat NUMERIC := 0;
  v_supplier_count INTEGER := 0;
  v_by_supplier JSONB := '[]'::jsonb;
  v_top_items JSONB := '[]'::jsonb;
  v_monthly_bars JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH pur AS (
    SELECT *
    FROM public.reporting_counted_purchases_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND purchase_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  )
  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(vat_amount), 0),
    COUNT(DISTINCT supplier_id)::integer
  INTO v_total_purchased, v_total_vat, v_supplier_count
  FROM pur;

  WITH pur AS (
    SELECT p.*, COALESCE(s.name, 'No Supplier') AS supplier_name
    FROM public.reporting_counted_purchases_v p
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE p.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
      AND p.purchase_date BETWEEN p_start_date AND p_end_date
      AND p.is_counted IS TRUE
  ),
  rows AS (
    SELECT
      supplier_name AS name,
      COALESCE(SUM(total_amount), 0) AS total,
      COUNT(*)::integer AS count,
      MAX(purchase_date)::text AS last_date
    FROM pur
    GROUP BY supplier_id, supplier_name
    ORDER BY total DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'total', total, 'count', count, 'lastDate', last_date)
    ORDER BY total DESC
  ), '[]'::jsonb)
  INTO v_by_supplier
  FROM rows;

  WITH pur AS (
    SELECT id
    FROM public.reporting_counted_purchases_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND purchase_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  rows AS (
    SELECT
      pi.name,
      COALESCE(SUM(pi.quantity), 0) AS quantity,
      COALESCE(SUM(pi.total), 0) AS total
    FROM pur
    JOIN public.purchase_items pi ON pi.purchase_id = pur.id
    GROUP BY pi.name
    ORDER BY total DESC
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'quantity', quantity, 'total', total)
    ORDER BY total DESC
  ), '[]'::jsonb)
  INTO v_top_items
  FROM rows;

  WITH months AS (
    SELECT generate_series(
      date_trunc('month', p_start_date)::date,
      date_trunc('month', p_end_date)::date,
      '1 month'::interval
    )::date AS month_start
  ),
  rows AS (
    SELECT
      to_char(m.month_start, 'YYYY-MM') AS month,
      COALESCE(SUM(p.total_amount), 0) AS purchases
    FROM months m
    LEFT JOIN public.reporting_counted_purchases_v p
      ON p.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
     AND p.purchase_date >= m.month_start
     AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
     AND p.purchase_date BETWEEN p_start_date AND p_end_date
     AND p.is_counted IS TRUE
    GROUP BY m.month_start
    ORDER BY m.month_start
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('month', month, 'Purchases', purchases)
    ORDER BY month
  ), '[]'::jsonb)
  INTO v_monthly_bars
  FROM rows;

  RETURN jsonb_build_object(
    'totalPurchased', v_total_purchased,
    'totalVat', v_total_vat,
    'supplierCount', v_supplier_count,
    'bySupplier', v_by_supplier,
    'topItems', v_top_items,
    'monthlyBars', v_monthly_bars,
    'countedRule', 'posted simple bills and confirmed receive-stock purchases only'
  );
END;
$$;


ALTER FUNCTION "public"."get_purchase_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_purchase_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") IS 'Safe purchase summary using posted simple bills and confirmed receive-stock purchases only.';



CREATE OR REPLACE FUNCTION "public"."get_register_session_summary"("p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_session_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_session_branch_id UUID;
  v_branch_summaries JSONB := '[]'::jsonb;
  v_session JSONB := NULL;
  v_long_open_threshold_hours NUMERIC := 18;
BEGIN
  IF p_session_id IS NOT NULL THEN
    SELECT branch_id
      INTO v_session_branch_id
    FROM public.pos_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Register session not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_scope
  FROM public.reporting_resolve_scope(COALESCE(p_branch_id, v_session_branch_id));

  WITH candidate_branches AS (
    SELECT b.id, b.tenant_id, b.name, b.logo_url, b.is_active, b.is_main_branch, b.created_at
    FROM public.branches b
    WHERE b.tenant_id = v_scope.scope_tenant_id
      AND b.is_active IS TRUE
      AND (
        CASE
          WHEN p_session_id IS NOT NULL THEN b.id = v_session_branch_id
          WHEN v_scope.scope_branch_id IS NOT NULL THEN b.id = v_scope.scope_branch_id
          ELSE TRUE
        END
      )
  ),
  selected_sessions AS (
    SELECT
      b.id AS branch_id,
      b.tenant_id,
      b.name AS branch_name,
      b.logo_url,
      b.is_main_branch,
      b.created_at AS branch_created_at,
      s.id AS session_id,
      s.opened_at,
      s.closed_at,
      s.opening_cash,
      s.closing_cash_actual,
      s.closing_cash_difference,
      s.status,
      s.closing_checks,
      CASE WHEN s.status = 'open' THEN TRUE ELSE FALSE END AS is_current_session,
      CASE WHEN s.status = 'closed' AND p_session_id IS NULL THEN TRUE ELSE FALSE END AS is_last_session
    FROM candidate_branches b
    LEFT JOIN LATERAL (
      SELECT ps.*
      FROM public.pos_sessions ps
      WHERE ps.tenant_id = b.tenant_id
        AND ps.branch_id = b.id
        AND (p_session_id IS NULL OR ps.id = p_session_id)
      ORDER BY
        CASE
          WHEN p_session_id IS NOT NULL THEN 0
          WHEN ps.status = 'open' THEN 0
          ELSE 1
        END,
        CASE
          WHEN ps.status = 'open' THEN ps.opened_at
          ELSE COALESCE(ps.closed_at, ps.opened_at)
        END DESC
      LIMIT 1
    ) s ON TRUE
    WHERE p_session_id IS NULL OR s.id = p_session_id
  ),
  inv AS (
    SELECT
      s.session_id,
      i.id,
      i.invoice_number,
      i.customer_id,
      i.invoice_date,
      i.created_at,
      i.status::text AS status,
      i.zatca_invoice_type::text AS document_type,
      COALESCE(i.payment_method::text, 'other') AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount,
      COALESCE(i.tax_amount, 0) AS tax_amount
    FROM selected_sessions s
    JOIN public.invoices i ON i.session_id = s.session_id
    WHERE i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  invoice_totals AS (
    SELECT
      session_id,
      COALESCE(SUM(accounting_sign * total_amount), 0) AS total_sales,
      COUNT(*)::integer AS invoice_count,
      COALESCE(SUM(accounting_sign * tax_amount), 0) AS vat_total,
      COALESCE(SUM(CASE WHEN document_type = 'credit_note' THEN total_amount ELSE 0 END), 0) AS credit_note_total
    FROM inv
    GROUP BY session_id
  ),
  payment_rows AS (
    SELECT
      inv.session_id,
      COALESCE(p.method::text, inv.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
        ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
      END AS signed_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  ),
  payment_totals AS (
    SELECT
      session_id,
      COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_amount ELSE 0 END), 0) AS cash_total,
      COALESCE(SUM(CASE WHEN method = 'card' THEN signed_amount ELSE 0 END), 0) AS card_total,
      COALESCE(SUM(CASE WHEN method = 'bank_transfer' THEN signed_amount ELSE 0 END), 0) AS bank_transfer_total,
      COALESCE(SUM(CASE WHEN method NOT IN ('cash', 'card', 'bank_transfer') THEN signed_amount ELSE 0 END), 0) AS other_total
    FROM payment_rows
    GROUP BY session_id
  ),
  expense_totals AS (
    SELECT
      s.session_id,
      COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0) AS expenses_total,
      COALESCE(SUM(CASE WHEN e.payment_method::text = 'cash' THEN COALESCE(e.total_paid, e.amount, 0) ELSE 0 END), 0) AS cash_expenses
    FROM selected_sessions s
    LEFT JOIN public.expenses e ON e.session_id = s.session_id
    GROUP BY s.session_id
  ),
  rows AS (
    SELECT
      s.branch_id,
      s.branch_name,
      s.logo_url,
      s.is_main_branch,
      s.branch_created_at,
      s.session_id,
      s.status,
      s.opened_at,
      s.closed_at,
      COALESCE(s.opening_cash, 0) AS opening_cash,
      s.closing_cash_actual,
      s.closing_checks,
      s.is_current_session,
      s.is_last_session,
      (
        s.status = 'open'
        AND s.opened_at IS NOT NULL
        AND s.opened_at < NOW() - (v_long_open_threshold_hours || ' hours')::interval
      ) AS is_long_open,
      CASE
        WHEN s.status = 'open' AND s.opened_at IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM (NOW() - s.opened_at)) / 3600.0, 1)
        ELSE NULL
      END AS long_open_hours,
      COALESCE(it.total_sales, 0) AS total_sales,
      COALESCE(it.invoice_count, 0) AS invoice_count,
      COALESCE(it.credit_note_total, 0) AS credit_note_total,
      COALESCE(it.vat_total, 0) AS vat_total,
      COALESCE(pt.cash_total, 0) AS cash_total,
      COALESCE(pt.card_total, 0) AS card_total,
      COALESCE(pt.bank_transfer_total, 0) AS bank_transfer_total,
      COALESCE(pt.other_total, 0) AS other_total,
      COALESCE(et.expenses_total, 0) AS expenses_total,
      COALESCE(et.cash_expenses, 0) AS cash_expenses,
      COALESCE(s.opening_cash, 0) + COALESCE(pt.cash_total, 0) - COALESCE(et.cash_expenses, 0) AS expected_cash
    FROM selected_sessions s
    LEFT JOIN invoice_totals it ON it.session_id = s.session_id
    LEFT JOIN payment_totals pt ON pt.session_id = s.session_id
    LEFT JOIN expense_totals et ON et.session_id = s.session_id
  ),
  summaries AS (
    SELECT
      -- Keep every jsonb_build_object under PostgreSQL's 100-argument limit.
      jsonb_build_object(
        'session_id', session_id,
        'sessionId', session_id,
        'branch_id', branch_id,
        'branchId', branch_id,
        'branch_name', branch_name,
        'branchName', branch_name,
        'logo_url', logo_url,
        'logoUrl', logo_url,
        'status', status,
        'opened_at', opened_at,
        'openedAt', opened_at,
        'closed_at', closed_at,
        'closedAt', closed_at,
        'is_current_session', is_current_session,
        'isCurrentSession', is_current_session,
        'is_last_session', is_last_session,
        'isLastSession', is_last_session,
        'is_long_open', is_long_open,
        'isLongOpen', is_long_open,
        'long_open_hours', long_open_hours,
        'longOpenHours', long_open_hours
      )
      ||
      jsonb_build_object(
        'total_sales', total_sales,
        'totalSales', total_sales,
        'invoice_count', invoice_count,
        'invoiceCount', invoice_count,
        'credit_note_total', credit_note_total,
        'creditNoteTotal', credit_note_total,
        'cash_total', cash_total,
        'cashTotal', cash_total,
        'card_total', card_total,
        'cardTotal', card_total,
        'other_total', other_total,
        'otherTotal', other_total,
        'bank_transfer_total', bank_transfer_total,
        'bankTransferTotal', bank_transfer_total,
        'vat_total', vat_total,
        'vatTotal', vat_total,
        'expenses_total', expenses_total,
        'expensesTotal', expenses_total,
        'cash_expenses', cash_expenses,
        'cashExpenses', cash_expenses,
        'expected_cash', expected_cash,
        'expectedCash', expected_cash
      )
      ||
      jsonb_build_object(
        'actual_cash', closing_cash_actual,
        'actualCash', closing_cash_actual,
        'cash_difference',
          CASE WHEN closing_cash_actual IS NULL THEN NULL ELSE closing_cash_actual - expected_cash END,
        'cashDifference',
          CASE WHEN closing_cash_actual IS NULL THEN NULL ELSE closing_cash_actual - expected_cash END,
        'opening_cash', opening_cash,
        'openingCash', opening_cash,
        'closing_checks', COALESCE(closing_checks, '{}'::jsonb),
        'closingChecks', COALESCE(closing_checks, '{}'::jsonb)
      )
      ||
      jsonb_build_object(
        'recent_invoices', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', recent.id,
              'invoice_number', recent.invoice_number,
              'invoiceNumber', recent.invoice_number,
              'customer_name', recent.customer_name,
              'customerName', recent.customer_name,
              'total_amount', recent.total_amount,
              'totalAmount', recent.total_amount,
              'display_total', recent.display_total,
              'displayTotal', recent.display_total,
              'status', recent.status,
              'invoice_date', recent.invoice_date,
              'invoiceDate', recent.invoice_date,
              'document_type', recent.document_type,
              'documentType', recent.document_type,
              'created_at', recent.created_at,
              'createdAt', recent.created_at
            )
            ORDER BY recent.created_at DESC
          )
          FROM (
            SELECT
              i.id,
              i.invoice_number,
              COALESCE(c.name, 'Walk-in Customer') AS customer_name,
              COALESCE(i.total_amount, 0) AS total_amount,
              CASE
                WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 * COALESCE(i.total_amount, 0)
                ELSE COALESCE(i.total_amount, 0)
              END AS display_total,
              i.status::text AS status,
              i.invoice_date,
              i.zatca_invoice_type::text AS document_type,
              i.created_at
            FROM public.invoices i
            LEFT JOIN public.customers c ON c.id = i.customer_id
            WHERE i.session_id = rows.session_id
              AND i.status::text = 'posted'
              AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
            ORDER BY i.created_at DESC
            LIMIT 6
          ) recent
        ), '[]'::jsonb),
        'recentInvoices', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', recent.id,
              'invoiceNumber', recent.invoice_number,
              'customerName', recent.customer_name,
              'totalAmount', recent.total_amount,
              'displayTotal', recent.display_total,
              'status', recent.status,
              'invoiceDate', recent.invoice_date,
              'documentType', recent.document_type,
              'createdAt', recent.created_at
            )
            ORDER BY recent.created_at DESC
          )
          FROM (
            SELECT
              i.id,
              i.invoice_number,
              COALESCE(c.name, 'Walk-in Customer') AS customer_name,
              COALESCE(i.total_amount, 0) AS total_amount,
              CASE
                WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 * COALESCE(i.total_amount, 0)
                ELSE COALESCE(i.total_amount, 0)
              END AS display_total,
              i.status::text AS status,
              i.invoice_date,
              i.zatca_invoice_type::text AS document_type,
              i.created_at
            FROM public.invoices i
            LEFT JOIN public.customers c ON c.id = i.customer_id
            WHERE i.session_id = rows.session_id
              AND i.status::text = 'posted'
              AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
            ORDER BY i.created_at DESC
            LIMIT 6
          ) recent
        ), '[]'::jsonb)
      ) AS summary,
      is_main_branch,
      branch_created_at,
      branch_name
    FROM rows
  )
  SELECT COALESCE(jsonb_agg(summary ORDER BY is_main_branch DESC, branch_created_at ASC, branch_name), '[]'::jsonb)
    INTO v_branch_summaries
  FROM summaries;

  IF jsonb_array_length(v_branch_summaries) = 1 THEN
    v_session := v_branch_summaries -> 0;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'long_open_threshold_hours', v_long_open_threshold_hours,
    'longOpenThresholdHours', v_long_open_threshold_hours,
    'session', v_session,
    'branch_summaries', v_branch_summaries,
    'branchSummaries', v_branch_summaries
  );
END;
$$;


ALTER FUNCTION "public"."get_register_session_summary"("p_branch_id" "uuid", "p_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_register_session_summary"("p_branch_id" "uuid", "p_session_id" "uuid") IS 'Phase 5C-5C fixed Register Session summary RPC. Summary JSON is built in smaller jsonb_build_object blocks to avoid PostgreSQL 100-argument limit.';



CREATE OR REPLACE FUNCTION "public"."get_register_sessions"("p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_row RECORD;
  v_sessions JSONB := '[]'::jsonb;
  v_summary JSONB;
BEGIN
  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  FOR v_row IN
    SELECT s.id
    FROM public.pos_sessions s
    WHERE s.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR s.branch_id = v_scope.scope_branch_id)
    ORDER BY
      CASE WHEN s.status = 'open' THEN 0 ELSE 1 END,
      COALESCE(s.closed_at, s.opened_at) DESC
    LIMIT v_limit
  LOOP
    v_summary := public.get_register_session_summary(NULL, v_row.id) -> 'session';
    IF v_summary IS NOT NULL THEN
      v_sessions := v_sessions || jsonb_build_array(v_summary);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sessions', v_sessions,
    'register_sessions', v_sessions,
    'registerSessions', v_sessions
  );
END;
$$;


ALTER FUNCTION "public"."get_register_sessions"("p_branch_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_register_sessions"("p_branch_id" "uuid", "p_limit" integer) IS 'Phase 5C-5B verified Register Sessions list RPC. Frontend parameter names: p_branch_id, p_limit.';



CREATE OR REPLACE FUNCTION "public"."get_register_sessions_filtered"("p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 80, "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 80), 1), 200);
  v_has_date_filter BOOLEAN := p_start_date IS NOT NULL OR p_end_date IS NOT NULL;
  v_row RECORD;
  v_sessions JSONB := '[]'::jsonb;
  v_summary JSONB;
BEGIN
  IF (p_start_date IS NULL) <> (p_end_date IS NULL)
     OR (p_start_date IS NOT NULL AND p_start_date > p_end_date)
  THEN
    RAISE EXCEPTION 'Invalid register session date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  FOR v_row IN
    SELECT s.id
    FROM public.pos_sessions s
    WHERE s.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR s.branch_id = v_scope.scope_branch_id)
      AND (
        v_has_date_filter IS FALSE
        OR (
          ((COALESCE(s.closed_at, s.opened_at) AT TIME ZONE 'Asia/Riyadh')::date)
            BETWEEN p_start_date AND p_end_date
        )
      )
    ORDER BY
      CASE WHEN v_has_date_filter IS FALSE AND s.status = 'open' THEN 0 ELSE 1 END,
      COALESCE(s.closed_at, s.opened_at) DESC
    LIMIT v_limit
  LOOP
    v_summary := public.get_register_session_summary(NULL, v_row.id) -> 'session';
    IF v_summary IS NOT NULL THEN
      v_sessions := v_sessions || jsonb_build_array(v_summary);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sessions', v_sessions,
    'register_sessions', v_sessions,
    'registerSessions', v_sessions
  );
END;
$$;


ALTER FUNCTION "public"."get_register_sessions_filtered"("p_branch_id" "uuid", "p_limit" integer, "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_register_sessions_filtered"("p_branch_id" "uuid", "p_limit" integer, "p_start_date" "date", "p_end_date" "date") IS 'Lists register session summaries with optional server-side date filtering before LIMIT is applied.';



CREATE OR REPLACE FUNCTION "public"."get_sales_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_gross_sales NUMERIC := 0;
  v_credit_notes NUMERIC := 0;
  v_total_revenue NUMERIC := 0;
  v_vat_on_sales NUMERIC := 0;
  v_vat_credited NUMERIC := 0;
  v_vat_collected NUMERIC := 0;
  v_invoice_count INTEGER := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  v_by_method JSONB := '[]'::jsonb;
  v_top_products JSONB := '[]'::jsonb;
  v_cat_performance JSONB := '[]'::jsonb;
  v_recent_invoices JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT
    COALESCE(SUM(i.gross_total_amount), 0),
    COALESCE(SUM(i.credited_total_amount), 0),
    COALESCE(SUM(i.signed_total_amount), 0),
    COALESCE(SUM(i.gross_tax_amount), 0),
    COALESCE(SUM(i.credited_tax_amount), 0),
    COALESCE(SUM(i.signed_tax_amount), 0),
    COUNT(*)::integer
  INTO
    v_gross_sales,
    v_credit_notes,
    v_total_revenue,
    v_vat_on_sales,
    v_vat_credited,
    v_vat_collected,
    v_invoice_count
  FROM public.reporting_invoice_documents_v AS i
  WHERE i.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
    AND i.invoice_date BETWEEN p_start_date AND p_end_date
    AND i.is_counted IS TRUE;

  WITH daily_rows AS (
    SELECT
      i.invoice_date::text AS report_date,
      COALESCE(SUM(i.signed_total_amount), 0) AS revenue_amount,
      COUNT(*)::integer AS invoice_total
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
    GROUP BY i.invoice_date
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', daily_rows.report_date,
      'revenue', daily_rows.revenue_amount,
      'invoices', daily_rows.invoice_total
    )
    ORDER BY daily_rows.report_date
  ), '[]'::jsonb)
  INTO v_daily_sales
  FROM daily_rows;

  WITH inv_doc AS (
    SELECT
      i.id AS invoice_id,
      i.accounting_sign,
      COALESCE(i.payment_method, 'cash') AS invoice_payment_method,
      i.signed_total_amount
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  payment_rows AS (
    SELECT
      COALESCE(pay.method::text, inv_doc.invoice_payment_method, 'cash') AS method_key,
      CASE
        WHEN pay.id IS NULL THEN inv_doc.signed_total_amount
        ELSE inv_doc.accounting_sign * COALESCE(pay.amount, 0)
      END AS signed_payment_amount
    FROM inv_doc
    LEFT JOIN public.payments AS pay
      ON pay.invoice_id = inv_doc.invoice_id
  ),
  method_rows AS (
    SELECT
      CASE payment_rows.method_key
        WHEN 'cash' THEN 'Cash'
        WHEN 'card' THEN 'Card'
        WHEN 'bank_transfer' THEN 'Bank Transfer'
        ELSE INITCAP(COALESCE(payment_rows.method_key, 'other'))
      END AS method_name,
      COALESCE(SUM(payment_rows.signed_payment_amount), 0) AS method_value
    FROM payment_rows
    GROUP BY payment_rows.method_key
    HAVING COALESCE(SUM(payment_rows.signed_payment_amount), 0) <> 0
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', method_rows.method_name, 'value', method_rows.method_value)
    ORDER BY method_rows.method_value DESC, method_rows.method_name
  ), '[]'::jsonb)
  INTO v_by_method
  FROM method_rows;

  WITH inv_doc AS (
    SELECT
      i.id AS invoice_id,
      i.tenant_id,
      i.accounting_sign
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  product_rows AS (
    SELECT
      COALESCE(NULLIF(TRIM(ii.name), ''), 'Unknown item') AS item_name,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.quantity, 0)), 0) AS quantity_sold,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.total, 0)), 0) AS revenue_amount
    FROM inv_doc
    JOIN public.invoice_items AS ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
    GROUP BY COALESCE(NULLIF(TRIM(ii.name), ''), 'Unknown item')
    ORDER BY revenue_amount DESC, item_name
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', product_rows.item_name,
      'quantity', product_rows.quantity_sold,
      'revenue', product_rows.revenue_amount,
      'pct', CASE
        WHEN v_total_revenue <> 0 THEN ROUND((product_rows.revenue_amount / v_total_revenue) * 100, 2)
        ELSE 0
      END
    )
    ORDER BY product_rows.revenue_amount DESC, product_rows.item_name
  ), '[]'::jsonb)
  INTO v_top_products
  FROM product_rows;

  WITH inv_doc AS (
    SELECT
      i.id AS invoice_id,
      i.tenant_id,
      i.accounting_sign
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  category_rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS category_name,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.quantity, 0)), 0) AS item_count,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.total, 0)), 0) AS revenue_amount
    FROM inv_doc
    JOIN public.invoice_items AS ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
    LEFT JOIN public.products AS pr
      ON pr.id = ii.product_id
     AND pr.tenant_id = inv_doc.tenant_id
    LEFT JOIN public.categories AS c
      ON c.id = pr.category_id
    GROUP BY COALESCE(c.name, 'Uncategorized')
    ORDER BY revenue_amount DESC, category_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', category_rows.category_name,
      'items', category_rows.item_count,
      'revenue', category_rows.revenue_amount,
      'pct', CASE
        WHEN v_total_revenue <> 0 THEN ROUND((category_rows.revenue_amount / v_total_revenue) * 100, 2)
        ELSE 0
      END
    )
    ORDER BY category_rows.revenue_amount DESC, category_rows.category_name
  ), '[]'::jsonb)
  INTO v_cat_performance
  FROM category_rows;

  WITH recent_rows AS (
    SELECT
      i.invoice_number,
      i.zatca_invoice_type,
      i.invoice_date::text AS invoice_date_text,
      i.signed_total_amount,
      i.signed_tax_amount
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
    ORDER BY i.invoice_date DESC, i.created_at DESC, i.invoice_number DESC
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'invoiceNumber', recent_rows.invoice_number,
      'type', recent_rows.zatca_invoice_type,
      'date', recent_rows.invoice_date_text,
      'total', recent_rows.signed_total_amount,
      'vat', recent_rows.signed_tax_amount
    )
    ORDER BY recent_rows.invoice_date_text DESC, recent_rows.invoice_number DESC
  ), '[]'::jsonb)
  INTO v_recent_invoices
  FROM recent_rows;

  RETURN jsonb_build_object(
    'grossSales', v_gross_sales,
    'creditNotes', v_credit_notes,
    'totalRevenue', v_total_revenue,
    'invoiceCount', v_invoice_count,
    'avgOrderValue', CASE WHEN v_invoice_count > 0 THEN ROUND(v_total_revenue / v_invoice_count, 2) ELSE 0 END,
    'vatOnSales', v_vat_on_sales,
    'vatCredited', v_vat_credited,
    'vatCollected', v_vat_collected,
    'dailySales', v_daily_sales,
    'byMethod', v_by_method,
    'paymentBreakdown', v_by_method,
    'topProducts', v_top_products,
    'catPerformance', v_cat_performance,
    'categoryBreakdown', v_cat_performance,
    'recentInvoices', v_recent_invoices
  );
END;
$$;


ALTER FUNCTION "public"."get_sales_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_sales_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") IS 'Safe server-side sales summary using posted invoice documents only; credit notes reduce totals.';



CREATE OR REPLACE FUNCTION "public"."get_super_admin_clients_billing_summary"() RETURNS TABLE("tenant_id" "uuid", "business_name" "text", "business_name_ar" "text", "vat_number" "text", "city" "text", "contact_name" "text", "contact_email" "text", "phone" "text", "business_type" "text", "tenant_is_active" boolean, "suspended_at" timestamp with time zone, "suspended_reason" "text", "created_at" timestamp with time zone, "subscription_id" "uuid", "subscription_plan_name" "text", "lifecycle_status" "text", "manual_payment_status" "text", "current_period_start" "date", "current_period_end" "date", "next_due_date" "date", "grace_until_date" "date", "days_until_due" integer, "days_overdue" integer, "can_use_pos" boolean, "access_reason" "text", "paid_branch_count" integer, "max_branches" integer, "active_branch_count" integer, "total_branch_count" integer, "user_count" integer, "remaining_branches" integer, "can_create_branch" boolean, "branch_usage_reason" "text", "last_payment_at" timestamp with time zone, "last_payment_amount" numeric, "last_payment_currency" "text", "last_payment_method" "text", "onboarding_status" "text", "owner_setup_status" "text", "branch_setup_status" "text", "zatca_setup_status" "text", "ready_for_billing" boolean, "billing_signal" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH super_admin_gate AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_active IS TRUE
        AND up.role::text = 'super_admin'
    ) AS allowed
  ),
  tenants_scope AS (
    SELECT t.*
    FROM public.tenants t
    CROSS JOIN super_admin_gate gate
    WHERE gate.allowed IS TRUE
  ),
  branch_counts AS (
    SELECT
      t.id AS tenant_id,
      GREATEST(COALESCE(t.max_branches, 999), 0)::integer AS max_branches,
      COUNT(b.id) FILTER (WHERE COALESCE(b.is_active, TRUE) IS TRUE)::integer AS active_branch_count,
      COUNT(b.id)::integer AS total_branch_count
    FROM tenants_scope t
    LEFT JOIN public.branches b ON b.tenant_id = t.id
    GROUP BY t.id, t.max_branches
  ),
  user_counts AS (
    SELECT
      t.id AS tenant_id,
      COUNT(up.id)::integer AS user_count
    FROM tenants_scope t
    LEFT JOIN public.user_profiles up ON up.tenant_id = t.id
    GROUP BY t.id
  ),
  latest_subscription AS (
    SELECT DISTINCT ON (ts.tenant_id)
      ts.*
    FROM public.tenant_subscriptions ts
    JOIN tenants_scope t ON t.id = ts.tenant_id
    ORDER BY ts.tenant_id, ts.created_at DESC
  ),
  latest_payment AS (
    SELECT DISTINCT ON (msp.tenant_id)
      msp.tenant_id,
      msp.payment_received_at AS last_payment_at,
      msp.amount AS last_payment_amount,
      msp.currency AS last_payment_currency,
      msp.payment_method AS last_payment_method
    FROM public.manual_subscription_payments msp
    JOIN tenants_scope t ON t.id = msp.tenant_id
    ORDER BY msp.tenant_id, msp.payment_received_at DESC, msp.created_at DESC
  ),
  owner_profile AS (
    SELECT DISTINCT ON (up.tenant_id)
      up.tenant_id,
      up.full_name AS contact_name,
      up.email AS contact_email
    FROM public.user_profiles up
    JOIN tenants_scope t ON t.id = up.tenant_id
    WHERE up.role::text = 'owner'
    ORDER BY up.tenant_id, up.created_at ASC
  ),
  calculated AS (
    SELECT
      t.id AS tenant_id,
      t.name AS business_name,
      t.name_ar AS business_name_ar,
      t.vat_number,
      t.city,
      owner_profile.contact_name,
      COALESCE(owner_profile.contact_email, t.email) AS contact_email,
      t.phone,
      t.business_type::text AS business_type,
      COALESCE(t.is_active, TRUE) AS tenant_is_active,
      t.suspended_at,
      t.suspended_reason,
      t.created_at,
      sub.id AS subscription_id,
      sp.name AS subscription_plan_name,
      sub.current_period_start,
      COALESCE(sub.current_period_end, sub.ends_at::date) AS current_period_end,
      COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) AS due_date,
      COALESCE(
        sub.grace_until_date,
        CASE
          WHEN COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) IS NOT NULL
          THEN COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) + 7
          ELSE NULL
        END
      ) AS grace_date,
      bc.max_branches,
      bc.active_branch_count,
      bc.total_branch_count,
      COALESCE(uc.user_count, 0)::integer AS user_count,
      GREATEST(COALESCE(sub.paid_branch_count, 1), 1)::integer AS paid_branch_count,
      lp.last_payment_at,
      lp.last_payment_amount,
      lp.last_payment_currency,
      lp.last_payment_method,
      tos.onboarding_status,
      tos.owner_setup_status,
      tos.branch_setup_status,
      tos.zatca_setup_status,
      COALESCE(tos.ready_for_billing, FALSE) AS ready_for_billing,
      CASE
        WHEN COALESCE(t.is_active, TRUE) IS NOT TRUE
          OR t.suspended_at IS NOT NULL
          OR sub.suspended_at IS NOT NULL THEN 'suspended'
        WHEN sub.id IS NULL THEN
          CASE
            WHEN COALESCE(t.is_active, TRUE) IS TRUE AND t.suspended_at IS NULL THEN 'active'
            ELSE 'suspended'
          END
        WHEN sub.cancelled_at IS NOT NULL
          OR sub.status::text = 'cancelled'
          OR sub.subscription_lifecycle_status = 'cancelled' THEN 'cancelled'
        WHEN sub.subscription_lifecycle_status = 'lifetime_free'
          OR (sub.status::text = 'active'
              AND COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) IS NULL
              AND sub.ends_at IS NULL) THEN 'lifetime_free'
        WHEN COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) IS NULL THEN
          COALESCE(NULLIF(sub.subscription_lifecycle_status, ''), 'active')
        WHEN CURRENT_DATE <= COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) THEN 'active'
        WHEN CURRENT_DATE <= COALESCE(
          sub.grace_until_date,
          COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) + 7
        ) THEN 'grace_period'
        ELSE 'payment_due'
      END AS computed_lifecycle
    FROM tenants_scope t
    LEFT JOIN latest_subscription sub ON sub.tenant_id = t.id
    LEFT JOIN public.subscription_plans sp ON sp.id = sub.plan_id
    LEFT JOIN branch_counts bc ON bc.tenant_id = t.id
    LEFT JOIN user_counts uc ON uc.tenant_id = t.id
    LEFT JOIN latest_payment lp ON lp.tenant_id = t.id
    LEFT JOIN public.tenant_onboarding_status tos ON tos.tenant_id = t.id
    LEFT JOIN owner_profile ON owner_profile.tenant_id = t.id
  )
  SELECT
    c.tenant_id,
    c.business_name,
    c.business_name_ar,
    c.vat_number,
    c.city,
    c.contact_name,
    c.contact_email,
    c.phone,
    c.business_type,
    c.tenant_is_active,
    c.suspended_at,
    c.suspended_reason,
    c.created_at,
    c.subscription_id,
    c.subscription_plan_name,
    c.computed_lifecycle AS lifecycle_status,
    CASE
      WHEN c.computed_lifecycle IN ('active', 'lifetime_free', 'grace_period')
        THEN COALESCE(sub.manual_payment_status, 'manual_verified')
      WHEN c.computed_lifecycle = 'payment_due' THEN 'overdue'
      WHEN c.computed_lifecycle = 'cancelled' THEN COALESCE(sub.manual_payment_status, 'unpaid')
      WHEN c.computed_lifecycle = 'suspended' THEN COALESCE(sub.manual_payment_status, 'overdue')
      ELSE COALESCE(sub.manual_payment_status, 'unpaid')
    END AS manual_payment_status,
    c.current_period_start,
    c.current_period_end,
    c.due_date AS next_due_date,
    c.grace_date AS grace_until_date,
    CASE WHEN c.due_date IS NULL THEN NULL ELSE (c.due_date - CURRENT_DATE)::integer END AS days_until_due,
    CASE WHEN c.due_date IS NULL OR CURRENT_DATE <= c.due_date THEN 0 ELSE (CURRENT_DATE - c.due_date)::integer END AS days_overdue,
    CASE
      WHEN c.computed_lifecycle IN ('cancelled', 'suspended', 'payment_due') THEN FALSE
      ELSE TRUE
    END AS can_use_pos,
    CASE
      WHEN c.subscription_id IS NULL AND c.computed_lifecycle = 'active' THEN 'legacy_no_subscription_record'
      WHEN c.computed_lifecycle = 'lifetime_free' THEN 'lifetime_free'
      WHEN c.computed_lifecycle = 'active' THEN 'subscription_active'
      WHEN c.computed_lifecycle = 'grace_period' THEN 'within_grace_period'
      WHEN c.computed_lifecycle = 'payment_due' THEN 'payment_overdue_after_grace'
      WHEN c.computed_lifecycle = 'cancelled' THEN 'subscription_cancelled'
      WHEN c.computed_lifecycle = 'suspended' THEN 'tenant_or_subscription_suspended'
      ELSE c.computed_lifecycle
    END AS access_reason,
    c.paid_branch_count,
    c.max_branches,
    c.active_branch_count,
    c.total_branch_count,
    c.user_count,
    GREATEST(c.max_branches - c.active_branch_count, 0)::integer AS remaining_branches,
    c.active_branch_count < c.max_branches AS can_create_branch,
    CASE
      WHEN c.active_branch_count < c.max_branches THEN 'within_branch_limit'
      ELSE 'branch_limit_reached'
    END AS branch_usage_reason,
    c.last_payment_at,
    c.last_payment_amount,
    c.last_payment_currency,
    c.last_payment_method,
    c.onboarding_status,
    c.owner_setup_status,
    c.branch_setup_status,
    c.zatca_setup_status,
    c.ready_for_billing,
    CASE
      WHEN c.tenant_is_active IS NOT TRUE OR c.computed_lifecycle = 'suspended' THEN 'suspended'
      WHEN c.computed_lifecycle = 'lifetime_free' THEN 'paid'
      WHEN c.due_date IS NOT NULL
        AND CURRENT_DATE <= c.due_date
        AND (c.due_date - CURRENT_DATE) BETWEEN 0 AND 7 THEN 'due_soon'
      WHEN c.due_date IS NOT NULL AND CURRENT_DATE <= c.due_date THEN 'paid'
      WHEN c.due_date IS NOT NULL
        AND CURRENT_DATE > c.due_date
        AND c.grace_date IS NOT NULL
        AND CURRENT_DATE <= c.grace_date THEN 'in_grace'
      WHEN c.grace_date IS NOT NULL AND CURRENT_DATE > c.grace_date THEN 'overdue'
      WHEN c.computed_lifecycle = 'payment_due' THEN 'overdue'
      ELSE 'unknown'
    END AS billing_signal
  FROM calculated c
  LEFT JOIN latest_subscription sub ON sub.id = c.subscription_id
  ORDER BY c.created_at DESC;
$$;


ALTER FUNCTION "public"."get_super_admin_clients_billing_summary"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_super_admin_clients_billing_summary"() IS 'Returns one billing/onboarding/branch summary row per tenant for super-admin client list visibility. Returns no rows for non-super-admin callers.';



CREATE OR REPLACE FUNCTION "public"."get_supplier_purchase_totals"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_rows JSONB := '[]'::jsonb;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for supplier purchase totals' USING ERRCODE = '22023';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid supplier purchase date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH rows AS (
    SELECT
      p.supplier_id,
      COUNT(*)::integer AS purchase_count,
      COALESCE(SUM(p.total_amount), 0) AS total_purchased,
      COALESCE(SUM(p.vat_amount), 0) AS total_vat,
      MAX(p.purchase_date)::text AS last_purchase_date
    FROM public.reporting_counted_purchases_v p
    WHERE p.tenant_id = v_scope.scope_tenant_id
      AND p.branch_id = v_scope.scope_branch_id
      AND p.purchase_date BETWEEN p_start_date AND p_end_date
      AND p.is_counted IS TRUE
      AND p.supplier_id IS NOT NULL
    GROUP BY p.supplier_id
    ORDER BY total_purchased DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'supplier_id', supplier_id,
      'supplierId', supplier_id,
      'purchase_count', purchase_count,
      'purchaseCount', purchase_count,
      'total_purchased', total_purchased,
      'totalPurchased', total_purchased,
      'total_vat', total_vat,
      'totalVat', total_vat,
      'last_purchase_date', last_purchase_date,
      'lastPurchaseDate', last_purchase_date
    )
    ORDER BY total_purchased DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM rows;

  RETURN jsonb_build_object(
    'ok', true,
    'supplier_totals', v_rows,
    'supplierTotals', v_rows
  );
END;
$$;


ALTER FUNCTION "public"."get_supplier_purchase_totals"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_supplier_purchase_totals"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") IS 'Returns per-supplier purchase totals for one branch and date range using counted purchase reporting rules.';



CREATE OR REPLACE FUNCTION "public"."get_tenant_branch_usage"("p_tenant_id" "uuid") RETURNS TABLE("tenant_id" "uuid", "max_branches" integer, "active_branch_count" integer, "total_branch_count" integer, "remaining_branches" integer, "can_create_branch" boolean, "reason" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH tenant_row AS (
    SELECT
      t.id,
      GREATEST(COALESCE(t.max_branches, 999), 0)::integer AS max_branches
    FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND (
        public.is_super_admin()
        OR public.get_my_tenant_id() = t.id
      )
  ),
  counts AS (
    SELECT
      tr.id AS tenant_id,
      tr.max_branches,
      COUNT(b.id) FILTER (WHERE COALESCE(b.is_active, TRUE) IS TRUE)::integer AS active_branch_count,
      COUNT(b.id)::integer AS total_branch_count
    FROM tenant_row tr
    LEFT JOIN public.branches b ON b.tenant_id = tr.id
    GROUP BY tr.id, tr.max_branches
  )
  SELECT
    c.tenant_id,
    c.max_branches,
    c.active_branch_count,
    c.total_branch_count,
    GREATEST(c.max_branches - c.active_branch_count, 0)::integer AS remaining_branches,
    c.active_branch_count < c.max_branches AS can_create_branch,
    CASE
      WHEN c.active_branch_count < c.max_branches THEN 'within_branch_limit'
      ELSE 'branch_limit_reached'
    END AS reason
  FROM counts c;
$$;


ALTER FUNCTION "public"."get_tenant_branch_usage"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_tenant_branch_usage"("p_tenant_id" "uuid") IS 'Returns branch usage and branch-limit availability for a tenant without enforcing writes.';



CREATE OR REPLACE FUNCTION "public"."get_tenant_subscription_access"("p_tenant_id" "uuid") RETURNS TABLE("tenant_id" "uuid", "lifecycle_status" "text", "manual_payment_status" "text", "max_branches" integer, "paid_branch_count" integer, "current_period_end" "date", "next_due_date" "date", "grace_until_date" "date", "days_until_due" integer, "days_overdue" integer, "can_use_pos" boolean, "can_create_branch" boolean, "reason" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant RECORD;
  v_sub RECORD;
  v_has_sub BOOLEAN := FALSE;
  v_due DATE;
  v_grace DATE;
  v_lifecycle TEXT;
  v_payment_status TEXT;
  v_can_create_branch BOOLEAN := FALSE;
BEGIN
  SELECT
    t.id,
    COALESCE(t.is_active, TRUE) AS is_active,
    t.suspended_at,
    GREATEST(COALESCE(t.max_branches, 999), 0)::integer AS max_branches
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = p_tenant_id
    AND (
      public.is_super_admin()
      OR public.get_my_tenant_id() = t.id
    );

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      p_tenant_id,
      'not_found'::TEXT,
      'unpaid'::TEXT,
      0,
      0,
      NULL::DATE,
      NULL::DATE,
      NULL::DATE,
      NULL::INTEGER,
      NULL::INTEGER,
      FALSE,
      FALSE,
      'tenant_not_found_or_forbidden'::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_sub
  FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = p_tenant_id
  ORDER BY ts.created_at DESC
  LIMIT 1;
  v_has_sub := FOUND;

  SELECT usage.can_create_branch
  INTO v_can_create_branch
  FROM public.get_tenant_branch_usage(p_tenant_id) AS usage
  LIMIT 1;
  v_can_create_branch := COALESCE(v_can_create_branch, FALSE);

  IF NOT v_has_sub THEN
    RETURN QUERY
    SELECT
      v_tenant.id,
      CASE WHEN v_tenant.is_active IS TRUE AND v_tenant.suspended_at IS NULL THEN 'active' ELSE 'suspended' END,
      'unpaid'::TEXT,
      v_tenant.max_branches,
      1,
      NULL::DATE,
      NULL::DATE,
      NULL::DATE,
      NULL::INTEGER,
      NULL::INTEGER,
      (v_tenant.is_active IS TRUE AND v_tenant.suspended_at IS NULL),
      v_can_create_branch,
      CASE
        WHEN v_tenant.is_active IS TRUE AND v_tenant.suspended_at IS NULL THEN 'legacy_no_subscription_record'
        ELSE 'tenant_inactive_or_suspended'
      END;
    RETURN;
  END IF;

  v_due := COALESCE(v_sub.next_due_date, v_sub.current_period_end, v_sub.ends_at::date);
  v_grace := COALESCE(v_sub.grace_until_date, CASE WHEN v_due IS NOT NULL THEN v_due + 7 ELSE NULL END);

  IF v_tenant.is_active IS NOT TRUE OR v_tenant.suspended_at IS NOT NULL OR v_sub.suspended_at IS NOT NULL THEN
    v_lifecycle := 'suspended';
  ELSIF v_sub.cancelled_at IS NOT NULL
        OR v_sub.status::text = 'cancelled'
        OR v_sub.subscription_lifecycle_status = 'cancelled' THEN
    v_lifecycle := 'cancelled';
  ELSIF v_sub.subscription_lifecycle_status = 'lifetime_free'
        OR (v_sub.status::text = 'active' AND v_due IS NULL AND v_sub.ends_at IS NULL) THEN
    v_lifecycle := 'lifetime_free';
  ELSIF v_due IS NULL THEN
    v_lifecycle := COALESCE(NULLIF(v_sub.subscription_lifecycle_status, ''), 'active');
  ELSIF CURRENT_DATE <= v_due THEN
    v_lifecycle := 'active';
  ELSIF v_grace IS NOT NULL AND CURRENT_DATE <= v_grace THEN
    v_lifecycle := 'grace_period';
  ELSE
    v_lifecycle := 'payment_due';
  END IF;

  v_payment_status := CASE
    WHEN v_lifecycle IN ('active', 'lifetime_free', 'grace_period') THEN COALESCE(v_sub.manual_payment_status, 'manual_verified')
    WHEN v_lifecycle = 'payment_due' THEN 'overdue'
    WHEN v_lifecycle = 'cancelled' THEN COALESCE(v_sub.manual_payment_status, 'unpaid')
    WHEN v_lifecycle = 'suspended' THEN COALESCE(v_sub.manual_payment_status, 'overdue')
    ELSE COALESCE(v_sub.manual_payment_status, 'unpaid')
  END;

  RETURN QUERY
  SELECT
    v_tenant.id,
    v_lifecycle,
    v_payment_status,
    v_tenant.max_branches,
    GREATEST(COALESCE(v_sub.paid_branch_count, 1), 1)::integer,
    COALESCE(v_sub.current_period_end, v_sub.ends_at::date),
    v_due,
    v_grace,
    CASE WHEN v_due IS NULL THEN NULL ELSE (v_due - CURRENT_DATE)::integer END,
    CASE WHEN v_due IS NULL OR CURRENT_DATE <= v_due THEN 0 ELSE (CURRENT_DATE - v_due)::integer END,
    CASE
      WHEN v_lifecycle IN ('cancelled', 'suspended', 'payment_due') THEN FALSE
      ELSE TRUE
    END,
    v_can_create_branch,
    CASE
      WHEN v_lifecycle = 'lifetime_free' THEN 'lifetime_free'
      WHEN v_lifecycle = 'active' THEN 'subscription_active'
      WHEN v_lifecycle = 'grace_period' THEN 'within_grace_period'
      WHEN v_lifecycle = 'payment_due' THEN 'payment_overdue_after_grace'
      WHEN v_lifecycle = 'cancelled' THEN 'subscription_cancelled'
      WHEN v_lifecycle = 'suspended' THEN 'tenant_or_subscription_suspended'
      ELSE v_lifecycle
    END;
END;
$$;


ALTER FUNCTION "public"."get_tenant_subscription_access"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_tenant_subscription_access"("p_tenant_id" "uuid") IS 'Calculates manual subscription access state for future POS/branch enforcement; this phase does not wire it into checkout.';



CREATE OR REPLACE FUNCTION "public"."get_vat_support_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_scope RECORD;
  v_gross_sales NUMERIC := 0;
  v_credit_notes NUMERIC := 0;
  v_vat_on_sales NUMERIC := 0;
  v_vat_credited NUMERIC := 0;
  v_vat_collected NUMERIC := 0;
  v_vat_paid_purchases NUMERIC := 0;
  v_vat_paid_expenses NUMERIC := 0;
  v_sales_total NUMERIC := 0;
  v_monthly_rows JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  pur AS (
    SELECT *
    FROM public.reporting_counted_purchases_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND purchase_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  exp AS (
    SELECT *
    FROM public.reporting_expenses_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND expense_date BETWEEN p_start_date AND p_end_date
  )
  SELECT
    COALESCE((SELECT SUM(gross_total_amount) FROM inv), 0),
    COALESCE((SELECT SUM(credited_total_amount) FROM inv), 0),
    COALESCE((SELECT SUM(gross_tax_amount) FROM inv), 0),
    COALESCE((SELECT SUM(credited_tax_amount) FROM inv), 0),
    COALESCE((SELECT SUM(signed_tax_amount) FROM inv), 0),
    COALESCE((SELECT SUM(signed_total_amount) FROM inv), 0),
    COALESCE((SELECT SUM(vat_amount) FROM pur), 0),
    COALESCE((SELECT SUM(input_vat_amount) FROM exp), 0)
  INTO
    v_gross_sales,
    v_credit_notes,
    v_vat_on_sales,
    v_vat_credited,
    v_vat_collected,
    v_sales_total,
    v_vat_paid_purchases,
    v_vat_paid_expenses;

  WITH months AS (
    SELECT generate_series(
      date_trunc('month', p_start_date)::date,
      date_trunc('month', p_end_date)::date,
      '1 month'::interval
    )::date AS month_start
  ),
  rows AS (
    SELECT
      to_char(m.month_start, 'YYYY-MM') AS month,
      COALESCE(SUM(i.gross_total_amount), 0) AS gross_sales,
      COALESCE(SUM(i.credited_total_amount), 0) AS credit_notes,
      COALESCE(SUM(i.signed_total_amount), 0) AS sales_amount,
      COALESCE(SUM(i.gross_tax_amount), 0) AS vat_on_sales,
      COALESCE(SUM(i.credited_tax_amount), 0) AS vat_credited,
      COALESCE(SUM(i.signed_tax_amount), 0) AS vat_collected,
      COALESCE((
        SELECT SUM(p.total_amount)
        FROM public.reporting_counted_purchases_v p
        WHERE p.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
          AND p.purchase_date >= m.month_start
          AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
          AND p.is_counted IS TRUE
      ), 0) AS purchase_amount,
      COALESCE((
        SELECT SUM(p.vat_amount)
        FROM public.reporting_counted_purchases_v p
        WHERE p.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
          AND p.purchase_date >= m.month_start
          AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
          AND p.is_counted IS TRUE
      ), 0) AS vat_paid_pur,
      COALESCE((
        SELECT SUM(e.total_paid)
        FROM public.reporting_expenses_v e
        WHERE e.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
          AND e.expense_date >= m.month_start
          AND e.expense_date < (m.month_start + INTERVAL '1 month')::date
      ), 0) AS expense_amount,
      COALESCE((
        SELECT SUM(e.input_vat_amount)
        FROM public.reporting_expenses_v e
        WHERE e.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
          AND e.expense_date >= m.month_start
          AND e.expense_date < (m.month_start + INTERVAL '1 month')::date
      ), 0) AS vat_paid_exp
    FROM months m
    LEFT JOIN public.reporting_invoice_documents_v i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date >= m.month_start
     AND i.invoice_date < (m.month_start + INTERVAL '1 month')::date
     AND i.invoice_date BETWEEN p_start_date AND p_end_date
     AND i.is_counted IS TRUE
    GROUP BY m.month_start
    ORDER BY m.month_start
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', month,
      'grossSales', gross_sales,
      'creditNotes', credit_notes,
      'salesAmount', sales_amount,
      'vatOnSales', vat_on_sales,
      'vatCredited', vat_credited,
      'vatCollected', vat_collected,
      'purchaseAmount', purchase_amount,
      'vatPaidPur', vat_paid_pur,
      'expenseAmount', expense_amount,
      'vatPaidExp', vat_paid_exp,
      'netPayable', vat_collected - vat_paid_pur - vat_paid_exp
    )
    ORDER BY month
  ), '[]'::jsonb)
  INTO v_monthly_rows
  FROM rows;

  RETURN jsonb_build_object(
    'grossSales', v_gross_sales,
    'creditNotes', v_credit_notes,
    'vatOnSales', v_vat_on_sales,
    'vatCredited', v_vat_credited,
    'vatCollected', v_vat_collected,
    'vatPaidTotal', v_vat_paid_purchases + v_vat_paid_expenses,
    'netPayable', v_vat_collected - v_vat_paid_purchases - v_vat_paid_expenses,
    'salesTotal', v_sales_total,
    'monthlyRows', v_monthly_rows,
    'reportLabel', 'VAT Support Report',
    'accountantReviewRequired', TRUE
  );
END;
$$;


ALTER FUNCTION "public"."get_vat_support_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_vat_support_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") IS 'Safe VAT support summary. Excludes pending/reversed purchases and treats existing expense VAT fields as support data, not tax advice.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Silent no-op on login upserts (GoTrue re-fires INSERT trigger).
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = NEW.id) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.user_profiles (id, full_name, role, tenant_id, branch_id)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(
            (NEW.raw_user_meta_data ->> 'role')::public.user_role,
            'owner'   -- public signup default; branch invites pass role='branch' explicitly
        ),
        NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'tenant_id', '')), '')::uuid,
        NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'branch_id', '')), '')::uuid
    );

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_reserved_branch_login_username"("p_username" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT public.normalize_branch_login_username(p_username) = ANY (ARRAY[
    'admin',
    'support',
    'kubri',
    'superadmin',
    'root',
    'api',
    'www',
    'login',
    'billing',
    'zatca',
    'owner',
    'branch',
    'system',
    'test'
  ])
$$;


ALTER FUNCTION "public"."is_reserved_branch_login_username"("p_username" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_reserved_branch_login_username"("p_username" "text") IS 'Blocks reserved branch login usernames such as admin, support, kubri, and zatca.';



CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role::text = 'super_admin'
      AND up.is_active IS TRUE
  )
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_valid_branch_login_username"("p_username" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $_$
  SELECT
    length(v_normalized) BETWEEN 3 AND 32
    AND position('@' IN v_normalized) = 0
    AND v_normalized ~ '^[a-z0-9][a-z0-9_-]*[a-z0-9]$'
    AND v_normalized !~ '[_-]{2,}'
    AND public.is_reserved_branch_login_username(v_normalized) IS FALSE
  FROM (
    SELECT public.normalize_branch_login_username(p_username) AS v_normalized
  ) normalized
$_$;


ALTER FUNCTION "public"."is_valid_branch_login_username"("p_username" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_valid_branch_login_username"("p_username" "text") IS 'Validates branch login usernames: 3-32 chars, lowercase a-z/0-9/_/-, no @, no spaces, no edge/repeated separators, no reserved names.';



CREATE OR REPLACE FUNCTION "public"."list_zatca_certificate_status"() RETURNS TABLE("id" "uuid", "tenant_id" "uuid", "branch_id" "uuid", "status" "text", "environment" "text", "serial_number" "text", "valid_from" timestamp with time zone, "valid_to" timestamp with time zone, "activated_at" timestamp with time zone, "invoice_counter" bigint, "certificate_exists" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    c.id,
    c.tenant_id,
    c.branch_id,
    c.status::text,
    c.environment::text,
    c.serial_number,
    c.valid_from,
    c.valid_to,
    NULLIF(to_jsonb(c) ->> 'activated_at', '')::timestamptz,
    c.invoice_counter,
    (
      NULLIF(to_jsonb(c) ->> 'certificate', '') IS NOT NULL
      OR NULLIF(to_jsonb(c) ->> 'compliance_csid', '') IS NOT NULL
      OR NULLIF(to_jsonb(c) ->> 'production_csid', '') IS NOT NULL
      OR c.status::text IN ('compliance', 'active')
    ),
    c.created_at,
    c.updated_at
  FROM public.zatca_certificates c
  WHERE public.rls_can_access_branch(c.tenant_id, c.branch_id)
  ORDER BY c.created_at DESC
$$;


ALTER FUNCTION "public"."list_zatca_certificate_status"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_zatca_certificate_status"() IS 'Safe browser-readable ZATCA certificate metadata. Does not expose CSR, certificates, private keys, OTPs, CSIDs, or secrets.';



CREATE OR REPLACE FUNCTION "public"."mark_owner_setup_complete"() RETURNS TABLE("tenant_id" "uuid", "onboarding_status" "text", "owner_setup_status" "text", "owner_setup_completed_at" timestamp with time zone, "already_completed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_existing_completed_at TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT
    up.tenant_id,
    up.role::text AS role,
    COALESCE(up.is_active, TRUE) AS is_active
  INTO v_profile
  FROM public.user_profiles up
  WHERE up.id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE OR v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role <> 'owner' THEN
    RAISE EXCEPTION 'Only tenant owners can complete owner setup tracking'
      USING ERRCODE = '42501';
  END IF;

  SELECT tos.owner_setup_completed_at
    INTO v_existing_completed_at
  FROM public.tenant_onboarding_status tos
  WHERE tos.tenant_id = v_profile.tenant_id;

  RETURN QUERY
  WITH upserted AS (
    INSERT INTO public.tenant_onboarding_status AS tos (
      tenant_id,
      onboarding_status,
      owner_setup_status,
      owner_setup_completed_at,
      updated_by
    ) VALUES (
      v_profile.tenant_id,
      'owner_setup_complete',
      'owner_setup_complete',
      NOW(),
      v_user_id
    )
    ON CONFLICT (tenant_id) DO UPDATE
      SET
        owner_setup_status = 'owner_setup_complete',
        owner_setup_completed_at = COALESCE(
          tos.owner_setup_completed_at,
          EXCLUDED.owner_setup_completed_at
        ),
        onboarding_status = CASE
          WHEN tos.onboarding_status IN ('details_pending', 'owner_invited')
            THEN 'owner_setup_complete'
          ELSE tos.onboarding_status
        END,
        updated_by = EXCLUDED.updated_by
      WHERE tos.owner_setup_status IS DISTINCT FROM 'owner_setup_complete'
         OR tos.owner_setup_completed_at IS NULL
         OR tos.onboarding_status IN ('details_pending', 'owner_invited')
    RETURNING
      tos.tenant_id,
      tos.onboarding_status,
      tos.owner_setup_status,
      tos.owner_setup_completed_at
  )
  SELECT
    u.tenant_id,
    u.onboarding_status,
    u.owner_setup_status,
    u.owner_setup_completed_at,
    v_existing_completed_at IS NOT NULL AS already_completed
  FROM upserted u

  UNION ALL

  SELECT
    tos.tenant_id,
    tos.onboarding_status,
    tos.owner_setup_status,
    tos.owner_setup_completed_at,
    TRUE AS already_completed
  FROM public.tenant_onboarding_status tos
  WHERE tos.tenant_id = v_profile.tenant_id
    AND NOT EXISTS (SELECT 1 FROM upserted);
END;
$$;


ALTER FUNCTION "public"."mark_owner_setup_complete"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_owner_setup_complete"() IS 'Idempotently marks owner setup complete for the authenticated owner caller tenant only.';



CREATE OR REPLACE FUNCTION "public"."next_product_sku"("p_tenant_id" "uuid", "p_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_prefix TEXT;
  v_value BIGINT;
  v_sku TEXT;
  v_attempts INTEGER := 0;
  v_max_attempts CONSTANT INTEGER := 100;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required for SKU generation' USING ERRCODE = '22023';
  END IF;

  v_prefix := public.product_sku_prefix(p_name);

  LOOP
    v_attempts := v_attempts + 1;

    INSERT INTO public.product_sku_counters (tenant_id, prefix, last_value)
    VALUES (p_tenant_id, v_prefix, 1)
    ON CONFLICT (tenant_id, prefix)
    DO UPDATE
      SET last_value = public.product_sku_counters.last_value + 1,
          updated_at = NOW()
    RETURNING last_value INTO v_value;

    v_sku := v_prefix || '-' || lpad(v_value::text, 4, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.tenant_id = p_tenant_id
        AND p.sku IS NOT NULL
        AND lower(btrim(p.sku)) = lower(v_sku)
    ) THEN
      RETURN v_sku;
    END IF;

    IF v_attempts >= v_max_attempts THEN
      RAISE EXCEPTION 'Unable to generate a unique product SKU. Please enter a SKU manually.'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."next_product_sku"("p_tenant_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_branch_login_username"("p_username" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT lower(btrim(COALESCE(p_username, '')))
$$;


ALTER FUNCTION "public"."normalize_branch_login_username"("p_username" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."normalize_branch_login_username"("p_username" "text") IS 'Trims and lowercases branch login usernames before validation or lookup.';



CREATE OR REPLACE FUNCTION "public"."normalize_product_sku"("p_sku" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_sku TEXT;
BEGIN
  IF p_sku IS NULL THEN
    RETURN NULL;
  END IF;

  v_sku := upper(btrim(p_sku));

  IF v_sku = '' THEN
    RAISE EXCEPTION 'SKU cannot be blank' USING ERRCODE = '22023';
  END IF;

  IF length(v_sku) < 3 OR length(v_sku) > 50 THEN
    RAISE EXCEPTION 'SKU must be 3 to 50 characters' USING ERRCODE = '22023';
  END IF;

  IF v_sku !~ '^[A-Z0-9][A-Z0-9_-]*[A-Z0-9]$' THEN
    RAISE EXCEPTION 'SKU may contain only A-Z, 0-9, hyphen, and underscore, and must start and end with a letter or number'
      USING ERRCODE = '22023';
  END IF;

  IF v_sku ~ '[-_]{2,}' THEN
    RAISE EXCEPTION 'SKU cannot contain repeated separators'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_sku;
END;
$_$;


ALTER FUNCTION "public"."normalize_product_sku"("p_sku" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_supplier_item_name"("p_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT NULLIF(
    trim(
      regexp_replace(
        regexp_replace(lower(COALESCE(p_name, '')), '[^[:alnum:]]+', ' ', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  )
$$;


ALTER FUNCTION "public"."normalize_supplier_item_name"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_register_session"("p_branch_id" "uuid", "p_opening_cash" numeric DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."open_register_session"("p_branch_id" "uuid", "p_opening_cash" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."open_register_session"("p_branch_id" "uuid", "p_opening_cash" numeric) IS 'Opens one Register Session per branch, blocks duplicate open sessions, and blocks new sessions for manually suspended tenants.';



CREATE OR REPLACE FUNCTION "public"."peek_product_sku"("p_tenant_id" "uuid", "p_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_prefix TEXT;
  v_value BIGINT;
  v_sku TEXT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required for SKU suggestion' USING ERRCODE = '22023';
  END IF;

  v_prefix := public.product_sku_prefix(p_name);

  SELECT COALESCE(c.last_value, 0) + 1
    INTO v_value
  FROM public.product_sku_counters c
  WHERE c.tenant_id = p_tenant_id
    AND c.prefix = v_prefix;

  v_value := COALESCE(v_value, 1);

  LOOP
    v_sku := v_prefix || '-' || lpad(v_value::text, 4, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.tenant_id = p_tenant_id
        AND p.sku IS NOT NULL
        AND lower(btrim(p.sku)) = lower(v_sku)
    ) THEN
      RETURN v_sku;
    END IF;

    v_value := v_value + 1;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."peek_product_sku"("p_tenant_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phase5e_assert_branch_scope"("p_tenant_id" "uuid", "p_branch_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Tenant and branch are required for branch operations.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;


ALTER FUNCTION "public"."phase5e_assert_branch_scope"("p_tenant_id" "uuid", "p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase5e_assert_branch_scope"("p_tenant_id" "uuid", "p_branch_id" "uuid") IS 'Phase 5E helper: validates that a branch-scoped operation references a branch owned by the tenant.';



CREATE OR REPLACE FUNCTION "public"."phase5e_assert_optional_branch_fk"("p_table" "text", "p_id" "uuid", "p_label" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_allow_tenant_wide" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $_$
DECLARE
  v_has_branch_id BOOLEAN;
  v_row RECORD;
  v_sql TEXT;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  IF p_table NOT IN (
    'categories',
    'suppliers',
    'inventory_items',
    'products',
    'customers'
  ) THEN
    RAISE EXCEPTION 'Unsupported branch validation table.'
      USING ERRCODE = '22023';
  END IF;

  v_has_branch_id := public.phase5e_column_exists(p_table, 'branch_id');
  v_sql := CASE
    WHEN v_has_branch_id THEN format('SELECT tenant_id, branch_id FROM public.%I WHERE id = $1', p_table)
    ELSE format('SELECT tenant_id, NULL::uuid AS branch_id FROM public.%I WHERE id = $1', p_table)
  END;

  EXECUTE v_sql INTO v_row USING p_id;

  IF NOT FOUND OR v_row.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION '% does not belong to this tenant.', p_label
      USING ERRCODE = '23514';
  END IF;

  IF v_row.branch_id IS NULL THEN
    IF p_allow_tenant_wide IS TRUE THEN
      RETURN;
    END IF;

    RAISE EXCEPTION '% must be branch-scoped.', p_label
      USING ERRCODE = '23514';
  END IF;

  IF v_row.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION '% does not belong to this branch.', p_label
      USING ERRCODE = '23514';
  END IF;
END;
$_$;


ALTER FUNCTION "public"."phase5e_assert_optional_branch_fk"("p_table" "text", "p_id" "uuid", "p_label" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_allow_tenant_wide" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase5e_assert_optional_branch_fk"("p_table" "text", "p_id" "uuid", "p_label" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_allow_tenant_wide" boolean) IS 'Phase 5E helper: validates tenant/branch ownership for optional foreign keys used by branch operation tables.';



CREATE OR REPLACE FUNCTION "public"."phase5e_column_exists"("p_table" "text", "p_column" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_column
  )
$$;


ALTER FUNCTION "public"."phase5e_column_exists"("p_table" "text", "p_column" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phase5e_validate_category_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_parent RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id, c.tenant_id, c.branch_id
    INTO v_parent
  FROM public.categories c
  WHERE c.id = NEW.parent_id;

  IF NOT FOUND OR v_parent.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Parent category does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_parent.branch_id IS NULL THEN
    RAISE EXCEPTION 'Parent category must be branch-scoped.'
      USING ERRCODE = '23514';
  END IF;

  IF v_parent.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Parent category does not belong to this branch.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_category_scope"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase5e_validate_category_scope"() IS 'Phase 5H explicit category parent tenant/branch validation for branch-scoped catalog operations.';



CREATE OR REPLACE FUNCTION "public"."phase5e_validate_customer_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_customer_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phase5e_validate_expense_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_category RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.category_id IS NOT NULL THEN
    SELECT ec.tenant_id, COALESCE(ec.is_system, FALSE) AS is_system
      INTO v_category
    FROM public.expense_categories ec
    WHERE ec.id = NEW.category_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Expense category does not exist.'
        USING ERRCODE = '23514';
    END IF;

    IF v_category.is_system IS NOT TRUE
       AND v_category.tenant_id IS DISTINCT FROM NEW.tenant_id
    THEN
      RAISE EXCEPTION 'Expense category does not belong to this tenant.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_expense_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phase5e_validate_inventory_item_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  PERFORM public.phase5e_assert_optional_branch_fk(
    'categories',
    NEW.category_id,
    'Inventory category',
    NEW.tenant_id,
    NEW.branch_id,
    TRUE
  );
  PERFORM public.phase5e_assert_optional_branch_fk(
    'suppliers',
    NEW.supplier_id,
    'Inventory supplier',
    NEW.tenant_id,
    NEW.branch_id,
    TRUE
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_inventory_item_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phase5e_validate_product_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_category RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id, c.tenant_id, c.branch_id
    INTO v_category
  FROM public.categories c
  WHERE c.id = NEW.category_id;

  IF NOT FOUND OR v_category.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Product category does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_category.branch_id IS NULL THEN
    RAISE EXCEPTION 'Product category must be branch-scoped.'
      USING ERRCODE = '23514';
  END IF;

  IF v_category.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Product category does not belong to this branch.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_product_scope"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase5e_validate_product_scope"() IS 'Phase 5H explicit product category tenant/branch validation for branch-scoped catalog operations.';



CREATE OR REPLACE FUNCTION "public"."phase5e_validate_purchase_item_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_purchase RECORD;
BEGIN
  SELECT p.id, p.tenant_id, p.branch_id
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = NEW.purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase does not exist.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.phase5e_assert_branch_scope(v_purchase.tenant_id, v_purchase.branch_id);
  PERFORM public.phase5e_assert_optional_branch_fk(
    'inventory_items',
    NEW.inventory_item_id,
    'Purchase inventory item',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    FALSE
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_purchase_item_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phase5e_validate_purchase_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_supplier RECORD;
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);

  IF NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.id, s.tenant_id, s.branch_id, COALESCE(s.is_active, TRUE) AS is_active
    INTO v_supplier
  FROM public.suppliers s
  WHERE s.id = NEW.supplier_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase supplier does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Purchase supplier does not belong to this tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Purchase supplier does not belong to this branch.'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchase supplier is not active.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_purchase_scope"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase5e_validate_purchase_scope"() IS 'Phase 5G fix: validates purchase supplier scope explicitly by tenant_id and branch_id to avoid Phase 5E generic helper false rejection for branch-scoped suppliers.';



CREATE OR REPLACE FUNCTION "public"."phase5e_validate_supplier_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
BEGIN
  PERFORM public.phase5e_assert_branch_scope(NEW.tenant_id, NEW.branch_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."phase5e_validate_supplier_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pos_checkout"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $_$
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
  ELSIF v_profile.role = 'owner' THEN
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
$_$;


ALTER FUNCTION "public"."pos_checkout"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."pos_checkout"("p_payload" "jsonb") IS 'POS checkout RPC. Supports legacy single payment checkout and branch-enabled Split Payment; blocks new billing for manually suspended tenants. Does not call ZATCA.';



CREATE OR REPLACE FUNCTION "public"."prevent_user_profile_self_privilege_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() = OLD.id THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Protected profile fields cannot be changed directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_user_profile_self_privilege_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_rpc_profile"() RETURNS TABLE("id" "uuid", "role" "text", "tenant_id" "uuid", "branch_id" "uuid", "is_active" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  SELECT up.id, up.role::text, up.tenant_id, up.branch_id, up.is_active
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
$$;


ALTER FUNCTION "public"."product_rpc_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_sku_prefix"("p_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_clean TEXT;
BEGIN
  v_clean := regexp_replace(upper(COALESCE(p_name, '')), '[^A-Z0-9]', '', 'g');

  IF v_clean = '' THEN
    RETURN 'PRD';
  END IF;

  RETURN left(rpad(v_clean, 3, 'X'), 3);
END;
$$;


ALTER FUNCTION "public"."product_sku_prefix"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."products_sku_normalize_generate_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
      NEW.sku := public.next_product_sku(NEW.tenant_id, NEW.name);
    ELSE
      NEW.sku := public.normalize_product_sku(NEW.sku);
    END IF;
  ELSIF NEW.sku IS DISTINCT FROM OLD.sku THEN
    IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
      NEW.sku := public.next_product_sku(NEW.tenant_id, NEW.name);
    ELSE
      NEW.sku := public.normalize_product_sku(NEW.sku);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."products_sku_normalize_generate_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_bill_path_is_valid"("p_tenant_id" "uuid", "p_branch_id" "uuid", "p_bill_path" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    p_tenant_id IS NOT NULL
    AND p_branch_id IS NOT NULL
    AND NULLIF(TRIM(COALESCE(p_bill_path, '')), '') IS NOT NULL
    AND p_bill_path LIKE p_tenant_id::text || '/' || p_branch_id::text || '/purchases/%'
    AND POSITION('..' IN p_bill_path) = 0,
    FALSE
  )
$$;


ALTER FUNCTION "public"."purchase_bill_path_is_valid"("p_tenant_id" "uuid", "p_branch_id" "uuid", "p_bill_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_edit_window_days"() RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT 45
$$;


ALTER FUNCTION "public"."purchase_edit_window_days"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_is_in_edit_window"("p_purchase_date" "date") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(p_purchase_date >= CURRENT_DATE - public.purchase_edit_window_days(), FALSE)
$$;


ALTER FUNCTION "public"."purchase_is_in_edit_window"("p_purchase_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."receive_product_stock"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_product RECORD;
  v_supplier RECORD;
  v_existing_receipt RECORD;
  v_receipt_id UUID := pg_catalog.gen_random_uuid();
  v_product_id UUID;
  v_supplier_id UUID;
  v_product_id_text TEXT;
  v_supplier_id_text TEXT;
  v_quantity NUMERIC(12, 3);
  v_unit_cost NUMERIC(12, 2);
  v_total_cost NUMERIC(12, 2);
  v_idempotency_key TEXT;
  v_note TEXT;
  v_reference TEXT;
  v_before_quantity NUMERIC(12, 3);
  v_after_quantity NUMERIC(12, 3);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product stock receipt payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_id',
      'supplier_id',
      'quantity',
      'unit_cost',
      'idempotency_key',
      'note',
      'reference'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product stock receipt field' USING ERRCODE = '22023';
  END IF;

  v_product_id_text := NULLIF(TRIM(COALESCE(p_payload ->> 'product_id', '')), '');
  IF v_product_id_text IS NULL THEN
    RAISE EXCEPTION 'Missing product id' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_product_id := v_product_id_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid product id' USING ERRCODE = '22023';
  END;

  v_supplier_id_text := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_id', '')), '');
  IF v_supplier_id_text IS NOT NULL THEN
    BEGIN
      v_supplier_id := v_supplier_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid supplier id' USING ERRCODE = '22023';
    END;
  END IF;

  IF NOT (p_payload ? 'quantity') OR jsonb_typeof(p_payload -> 'quantity') <> 'number' THEN
    RAISE EXCEPTION 'Quantity received must be a number' USING ERRCODE = '22023';
  END IF;

  v_quantity := (p_payload ->> 'quantity')::NUMERIC(12, 3);
  IF v_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity received must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'unit_cost') OR jsonb_typeof(p_payload -> 'unit_cost') <> 'number' THEN
    RAISE EXCEPTION 'Unit purchase cost must be a number' USING ERRCODE = '22023';
  END IF;

  v_unit_cost := (p_payload ->> 'unit_cost')::NUMERIC(12, 2);
  IF v_unit_cost < 0 THEN
    RAISE EXCEPTION 'Unit purchase cost must be zero or higher' USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  IF v_idempotency_key IS NULL
     OR length(v_idempotency_key) < 8
     OR length(v_idempotency_key) > 120
  THEN
    RAISE EXCEPTION 'Valid idempotency key is required' USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(TRIM(COALESCE(p_payload ->> 'note', '')), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023';
  END IF;

  v_reference := NULLIF(TRIM(COALESCE(p_payload ->> 'reference', '')), '');
  IF v_reference IS NOT NULL AND length(v_reference) > 120 THEN
    RAISE EXCEPTION 'Reference is too long' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT
      p.id,
      p.tenant_id,
      p.branch_id,
      p.name,
      p.track_stock,
      p.stock_quantity,
      p.is_service,
      p.is_active,
      b.is_active AS branch_is_active,
      b.stock_enabled,
      t.is_active AS tenant_is_active,
      COALESCE(t.business_type, 'trading') AS business_type
    INTO v_product
  FROM public.products p
  JOIN public.branches b ON b.id = p.branch_id
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = v_product_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_product.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_product.tenant_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Business account is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_product.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_product.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_product.branch_id
    THEN
      RAISE EXCEPTION 'Product belongs to another branch' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Insufficient permission to receive product stock' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_product.business_type, 'trading') = 'service' THEN
    RAISE EXCEPTION 'Product stock receiving is not available for service businesses'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_product.stock_enabled, TRUE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stock module is disabled for this branch'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_product.track_stock, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Product must track stock before receiving stock'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_product.is_service, FALSE) IS TRUE THEN
    RAISE EXCEPTION 'Service products cannot receive stock'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier_id IS NOT NULL THEN
    SELECT id, tenant_id, branch_id, is_active
      INTO v_supplier
    FROM public.suppliers
    WHERE id = v_supplier_id;

    IF NOT FOUND OR v_supplier.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Supplier not found or inactive' USING ERRCODE = '42501';
    END IF;

    IF v_supplier.tenant_id IS DISTINCT FROM v_product.tenant_id
       OR v_supplier.branch_id IS DISTINCT FROM v_product.branch_id
    THEN
      RAISE EXCEPTION 'Supplier belongs to another branch' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT *
    INTO v_existing_receipt
  FROM public.product_stock_receipts
  WHERE tenant_id = v_product.tenant_id
    AND branch_id = v_product.branch_id
    AND product_id = v_product.id
    AND idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'receipt_id', v_existing_receipt.id,
      'product_id', v_existing_receipt.product_id,
      'supplier_id', v_existing_receipt.supplier_id,
      'quantity', v_existing_receipt.quantity,
      'unit_cost', v_existing_receipt.unit_cost,
      'total_cost', v_existing_receipt.total_cost,
      'stock_quantity_before', COALESCE(v_product.stock_quantity, 0) - v_existing_receipt.quantity,
      'stock_quantity', COALESCE(v_product.stock_quantity, 0),
      'idempotency_key', v_existing_receipt.idempotency_key,
      'idempotent_replay', true,
      'created_at', v_existing_receipt.created_at
    );
  END IF;

  v_before_quantity := COALESCE(v_product.stock_quantity, 0);
  v_after_quantity := v_before_quantity + v_quantity;
  v_total_cost := round(v_quantity * v_unit_cost, 2);

  UPDATE public.products
  SET stock_quantity = v_after_quantity,
      cost = v_unit_cost,
      updated_at = v_now
  WHERE id = v_product.id;

  INSERT INTO public.product_stock_receipts (
    id,
    tenant_id,
    branch_id,
    product_id,
    supplier_id,
    quantity,
    unit_cost,
    total_cost,
    idempotency_key,
    note,
    reference,
    created_by,
    created_at
  ) VALUES (
    v_receipt_id,
    v_product.tenant_id,
    v_product.branch_id,
    v_product.id,
    v_supplier_id,
    v_quantity,
    v_unit_cost,
    v_total_cost,
    v_idempotency_key,
    v_note,
    v_reference,
    v_user_id,
    v_now
  );

  INSERT INTO public.pos_stock_movements (
    tenant_id,
    branch_id,
    product_id,
    invoice_id,
    quantity_delta,
    reason,
    created_by,
    created_at,
    idempotency_key
  ) VALUES (
    v_product.tenant_id,
    v_product.branch_id,
    v_product.id,
    NULL,
    v_quantity,
    'stock_receipt',
    v_user_id,
    v_now,
    v_idempotency_key
  );

  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id', v_receipt_id,
    'product_id', v_product.id,
    'supplier_id', v_supplier_id,
    'quantity', v_quantity,
    'unit_cost', v_unit_cost,
    'total_cost', v_total_cost,
    'stock_quantity_before', v_before_quantity,
    'stock_quantity', v_after_quantity,
    'idempotency_key', v_idempotency_key,
    'idempotent_replay', false,
    'created_at', v_now
  );
END;
$$;


ALTER FUNCTION "public"."receive_product_stock"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."receive_product_stock"("p_payload" "jsonb") IS 'Receives stock for an existing tracked saleable product, updates products.stock_quantity and latest cost, and records an audited product stock receipt.';



CREATE OR REPLACE FUNCTION "public"."record_audit_event"("p_action" "text", "p_tenant_id" "uuid" DEFAULT NULL::"uuid", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_actor_user_id" "uuid" DEFAULT NULL::"uuid", "p_actor_role" "text" DEFAULT NULL::"text", "p_target_type" "text" DEFAULT NULL::"text", "p_target_id" "uuid" DEFAULT NULL::"uuid", "p_severity" "text" DEFAULT 'info'::"text", "p_status" "text" DEFAULT 'attempted'::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_ip_hash" "text" DEFAULT NULL::"text", "p_request_id" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id UUID;
  v_action TEXT := NULLIF(TRIM(COALESCE(p_action, '')), '');
  v_severity TEXT := COALESCE(NULLIF(TRIM(p_severity), ''), 'info');
  v_status TEXT := COALESCE(NULLIF(TRIM(p_status), ''), 'attempted');
BEGIN
  IF v_action IS NULL THEN
    RAISE EXCEPTION 'Audit action is required' USING ERRCODE = '22023';
  END IF;

  IF v_severity NOT IN ('debug', 'info', 'warning', 'error', 'critical') THEN
    v_severity := 'info';
  END IF;

  IF v_status NOT IN ('attempted', 'succeeded', 'failed', 'blocked') THEN
    v_status := 'attempted';
  END IF;

  INSERT INTO public.audit_events (
    tenant_id,
    branch_id,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    severity,
    status,
    metadata,
    ip_hash,
    request_id
  ) VALUES (
    p_tenant_id,
    p_branch_id,
    p_actor_user_id,
    COALESCE(NULLIF(TRIM(p_actor_role), ''), public.audit_actor_role(p_actor_user_id)),
    v_action,
    NULLIF(TRIM(COALESCE(p_target_type, '')), ''),
    p_target_id,
    v_severity,
    v_status,
    public.audit_safe_metadata(p_metadata),
    NULLIF(TRIM(COALESCE(p_ip_hash, '')), ''),
    NULLIF(TRIM(COALESCE(p_request_id, '')), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."record_audit_event"("p_action" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_target_type" "text", "p_target_id" "uuid", "p_severity" "text", "p_status" "text", "p_metadata" "jsonb", "p_ip_hash" "text", "p_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_purchase_attachment_viewed"("p_purchase_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to view this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to view this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to view this attachment.'
      USING ERRCODE = '42501';
  END IF;

  IF v_purchase.bill_path IS NULL AND v_purchase.bill_url IS NULL THEN
    RAISE EXCEPTION 'No purchase attachment found' USING ERRCODE = '22023';
  END IF;

  PERFORM public.record_audit_event(
    'purchase_attachment_viewed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'has_bill_path', v_purchase.bill_path IS NOT NULL,
      'legacy_bill_url', v_purchase.bill_path IS NULL AND v_purchase.bill_url IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object('ok', true, 'purchase_id', v_purchase.id);
END;
$$;


ALTER FUNCTION "public"."record_purchase_attachment_viewed"("p_purchase_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reporting_resolve_scope"("p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("caller_id" "uuid", "caller_role" "text", "scope_tenant_id" "uuid", "profile_branch_id" "uuid", "scope_branch_id" "uuid", "tenant_scope" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NOT NULL THEN
    SELECT b.id, b.tenant_id
      INTO v_branch
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active IS TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  caller_id := v_profile.id;
  caller_role := v_profile.role;
  profile_branch_id := v_profile.branch_id;

  IF v_profile.role = 'super_admin' THEN
    IF p_branch_id IS NULL THEN
      IF v_profile.tenant_id IS NULL THEN
        RAISE EXCEPTION 'Branch is required for this report scope' USING ERRCODE = '42501';
      END IF;

      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := NULL;
      tenant_scope := TRUE;
    ELSE
      scope_tenant_id := v_branch.tenant_id;
      scope_branch_id := v_branch.id;
      tenant_scope := FALSE;
    END IF;

    RETURN NEXT;
    RETURN;
  END IF;

  IF v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Caller tenant not found' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    IF v_profile.role = 'owner' THEN
      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := NULL;
      tenant_scope := TRUE;
    ELSIF v_profile.role = 'branch' THEN
      IF v_profile.branch_id IS NULL THEN
        RAISE EXCEPTION 'Caller branch not found' USING ERRCODE = '42501';
      END IF;

      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := v_profile.branch_id;
      tenant_scope := FALSE;
    ELSE
      RAISE EXCEPTION 'You do not have permission to view this report.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_profile.role = 'owner' THEN
      IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
        RAISE EXCEPTION 'You do not have permission to view this branch report.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_profile.role = 'branch' THEN
      IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
         OR v_profile.branch_id IS DISTINCT FROM v_branch.id
      THEN
        RAISE EXCEPTION 'You do not have permission to view this branch report.'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'You do not have permission to view this branch report.'
        USING ERRCODE = '42501';
    END IF;

    scope_tenant_id := v_branch.tenant_id;
    scope_branch_id := v_branch.id;
    tenant_scope := FALSE;
  END IF;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."reporting_resolve_scope"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_can_access_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    public.rls_is_super_admin()
    OR public.rls_can_manage_tenant(p_tenant_id)
    OR (
      p_tenant_id IS NOT NULL
      AND p_branch_id IS NOT NULL
      AND p_tenant_id = public.rls_current_tenant_id()
      AND p_branch_id = public.rls_current_branch_id()
      AND public.rls_is_branch_staff()
    ),
    FALSE
  )
$$;


ALTER FUNCTION "public"."rls_can_access_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_can_access_tenant"("p_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    public.rls_is_super_admin()
    OR (
      p_tenant_id IS NOT NULL
      AND p_tenant_id = public.rls_current_tenant_id()
      AND public.rls_current_role_text() IN ('owner', 'branch')
    ),
    FALSE
  )
$$;


ALTER FUNCTION "public"."rls_can_access_tenant"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_can_manage_tenant"("p_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    public.rls_is_super_admin()
    OR (
      p_tenant_id IS NOT NULL
      AND p_tenant_id = public.rls_current_tenant_id()
      AND public.rls_is_tenant_admin()
    ),
    FALSE
  )
$$;


ALTER FUNCTION "public"."rls_can_manage_tenant"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_can_write_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.rls_can_access_branch(p_tenant_id, p_branch_id)
$$;


ALTER FUNCTION "public"."rls_can_write_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_current_branch_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT up.branch_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;


ALTER FUNCTION "public"."rls_current_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_current_role_text"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT up.role::text
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;


ALTER FUNCTION "public"."rls_current_role_text"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_current_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT up.tenant_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
  LIMIT 1
$$;


ALTER FUNCTION "public"."rls_current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_is_branch_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(public.rls_current_role_text() = 'branch', FALSE)
$$;


ALTER FUNCTION "public"."rls_is_branch_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(public.rls_current_role_text() = 'super_admin', FALSE)
$$;


ALTER FUNCTION "public"."rls_is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_is_tenant_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(public.rls_current_role_text() = 'owner', FALSE)
$$;


ALTER FUNCTION "public"."rls_is_tenant_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_purchase_bill_attachment"("p_purchase_id" "uuid", "p_bill_path" "text" DEFAULT NULL::"text", "p_clear" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_bill_path TEXT := NULLIF(TRIM(COALESCE(p_bill_path, '')), '');
  v_clear BOOLEAN := COALESCE(p_clear, FALSE);
  v_action TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to update this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to update this attachment.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to update this attachment.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.status, 'posted') = 'cancelled'
     OR COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('cancelled', 'reversed')
  THEN
    RAISE EXCEPTION 'This purchase can no longer be changed.'
      USING ERRCODE = '23514';
  END IF;

  IF v_clear IS NOT TRUE THEN
    IF v_bill_path IS NULL THEN
      RAISE EXCEPTION 'Bill attachment path is required' USING ERRCODE = '22023';
    END IF;

    IF public.purchase_bill_path_is_valid(v_purchase.tenant_id, v_purchase.branch_id, v_bill_path) IS NOT TRUE THEN
      RAISE EXCEPTION 'Bill attachment path is not valid for this purchase branch.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.purchases
  SET bill_path = CASE WHEN v_clear THEN NULL ELSE v_bill_path END,
      bill_url = CASE WHEN v_clear OR v_bill_path IS NOT NULL THEN NULL ELSE bill_url END,
      updated_at = NOW()
  WHERE id = v_purchase.id;

  v_action := CASE WHEN v_clear THEN 'purchase_attachment_removed' ELSE 'purchase_attachment_uploaded' END;

  PERFORM public.record_audit_event(
    v_action,
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    CASE WHEN v_clear THEN 'warning' ELSE 'info' END,
    'succeeded',
    jsonb_build_object(
      'storage_bucket', 'purchases-bills',
      'path_format', 'tenant/branch/purchases/object',
      'had_previous_bill_url', v_purchase.bill_url IS NOT NULL,
      'had_previous_bill_path', v_purchase.bill_path IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'attachment_path_set', v_clear IS NOT TRUE
  );
END;
$$;


ALTER FUNCTION "public"."set_purchase_bill_attachment"("p_purchase_id" "uuid", "p_bill_path" "text", "p_clear" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suggest_product_sku"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_scope RECORD;
  v_name TEXT;
  v_branch_id UUID;
  v_branch_id_text TEXT;
  v_sku TEXT;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid SKU suggestion payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN ('name', 'branch_id')
  ) THEN
    RAISE EXCEPTION 'Unsupported SKU suggestion field' USING ERRCODE = '22023';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Product name is required for SKU suggestion' USING ERRCODE = '22023';
  END IF;

  v_branch_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '');
  IF v_branch_id_text IS NOT NULL THEN
    BEGIN
      v_branch_id := v_branch_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid branch id' USING ERRCODE = '22023';
    END;
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(v_branch_id);

  v_sku := public.peek_product_sku(v_scope.tenant_id, v_name);

  RETURN jsonb_build_object(
    'ok', true,
    'sku', v_sku,
    'prefix', public.product_sku_prefix(v_name),
    'tenant_id', v_scope.tenant_id,
    'branch_id', v_scope.branch_id
  );
END;
$$;


ALTER FUNCTION "public"."suggest_product_sku"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."suggest_product_sku"("p_payload" "jsonb") IS 'Returns a non-authoritative product SKU suggestion for the authenticated tenant/branch.';



CREATE OR REPLACE FUNCTION "public"."suggest_supplier_item_mapping"("p_supplier_id" "uuid", "p_supplier_item_name" "text", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_supplier RECORD;
  v_branch_id UUID;
  v_normalized TEXT;
  v_mapping RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  v_normalized := public.normalize_supplier_item_name(p_supplier_item_name);
  IF v_normalized IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  v_branch_id := COALESCE(p_branch_id, v_profile.branch_id);

  SELECT s.id, s.tenant_id
    INTO v_supplier
  FROM public.suppliers s
  WHERE s.id = p_supplier_id;

  IF NOT FOUND OR v_supplier.tenant_id IS DISTINCT FROM v_profile.tenant_id THEN
    RAISE EXCEPTION 'Supplier not found for this tenant' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    NULL;
  ELSIF v_profile.role = 'branch' THEN
    IF v_branch_id IS NULL OR v_profile.branch_id IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'You do not have permission to use mappings for this branch.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to use supplier item mappings.'
      USING ERRCODE = '42501';
  END IF;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = v_branch_id
      AND b.tenant_id = v_profile.tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch not found for this tenant' USING ERRCODE = '42501';
  END IF;

  SELECT
    m.*,
    ii.name AS matched_inventory_item_name,
    ii.unit_cost AS matched_inventory_unit_cost
    INTO v_mapping
  FROM public.supplier_item_mappings m
  LEFT JOIN public.inventory_items ii
    ON ii.id = m.matched_inventory_item_id
   AND ii.tenant_id = m.tenant_id
   AND ii.branch_id = v_branch_id
  WHERE m.tenant_id = v_profile.tenant_id
    AND m.supplier_id = p_supplier_id
    AND m.normalized_supplier_item_name = v_normalized
    AND COALESCE(m.is_active, TRUE) IS TRUE
    AND (m.branch_id = v_branch_id OR m.branch_id IS NULL)
    AND (m.matched_inventory_item_id IS NULL OR ii.id IS NOT NULL)
  ORDER BY
    CASE WHEN m.branch_id = v_branch_id THEN 0 ELSE 1 END,
    CASE COALESCE(m.match_source, 'manual')
      WHEN 'manual' THEN 0
      WHEN 'imported' THEN 1
      WHEN 'ai' THEN 2
      ELSE 3
    END,
    m.confirmed_at DESC NULLS LAST,
    m.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  UPDATE public.supplier_item_mappings
  SET last_used_at = NOW(),
      updated_at = NOW()
  WHERE id = v_mapping.id;

  RETURN jsonb_build_object(
    'ok', true,
    'matched', true,
    'mapping_id', v_mapping.id,
    'supplier_id', p_supplier_id,
    'supplier_item_name', v_mapping.supplier_item_name,
    'matched_inventory_item_id', v_mapping.matched_inventory_item_id,
    'matched_inventory_item_name', v_mapping.matched_inventory_item_name,
    'matched_inventory_unit_cost', v_mapping.matched_inventory_unit_cost,
    'matched_product_id', v_mapping.matched_product_id,
    'match_source', v_mapping.match_source,
    'confidence', COALESCE(v_mapping.confidence, v_mapping.match_confidence)
  );
END;
$$;


ALTER FUNCTION "public"."suggest_supplier_item_mapping"("p_supplier_id" "uuid", "p_supplier_item_name" "text", "p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_branch_invoice_settings"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_branch_id UUID;
  v_display_name TEXT;
  v_phone TEXT;
  v_logo_url TEXT;
  v_website TEXT;
  v_email TEXT;
  v_receipt_footer TEXT;
  v_print_mode TEXT;
  v_show_logo BOOLEAN;
  v_show_website BOOLEAN;
  v_show_email BOOLEAN;
  v_show_footer BOOLEAN;
  v_show_cash_change BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid invoice settings payload' USING ERRCODE = '22023';
  END IF;

  v_branch_id := NULLIF(TRIM(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = v_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_display_name := NULLIF(TRIM(COALESCE(p_payload ->> 'display_name', '')), '');
  v_phone := NULLIF(TRIM(COALESCE(p_payload ->> 'phone', '')), '');
  v_logo_url := NULLIF(TRIM(COALESCE(p_payload ->> 'logo_url', '')), '');
  v_website := NULLIF(TRIM(COALESCE(p_payload ->> 'website', '')), '');
  v_email := NULLIF(TRIM(COALESCE(p_payload ->> 'email', '')), '');
  v_receipt_footer := NULLIF(TRIM(COALESCE(p_payload ->> 'receipt_footer', '')), '');
  v_print_mode := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'print_mode', '')), ''), 'thermal');
  v_show_logo := COALESCE((p_payload ->> 'show_logo')::boolean, TRUE);
  v_show_website := COALESCE((p_payload ->> 'show_website')::boolean, FALSE);
  v_show_email := COALESCE((p_payload ->> 'show_email')::boolean, FALSE);
  v_show_footer := COALESCE((p_payload ->> 'show_footer')::boolean, TRUE);
  v_show_cash_change := COALESCE((p_payload ->> 'show_cash_change')::boolean, TRUE);

  IF v_print_mode NOT IN ('thermal', 'pdf', 'both') THEN
    RAISE EXCEPTION 'Invalid print_mode' USING ERRCODE = '22023';
  END IF;

  IF v_display_name IS NOT NULL AND length(v_display_name) > 160 THEN
    RAISE EXCEPTION 'Display name is too long' USING ERRCODE = '22023';
  END IF;

  IF v_phone IS NOT NULL AND length(v_phone) > 50 THEN
    RAISE EXCEPTION 'Phone is too long' USING ERRCODE = '22023';
  END IF;

  IF v_logo_url IS NOT NULL AND length(v_logo_url) > 1000 THEN
    RAISE EXCEPTION 'Logo URL is too long' USING ERRCODE = '22023';
  END IF;

  IF v_website IS NOT NULL AND length(v_website) > 255 THEN
    RAISE EXCEPTION 'Website is too long' USING ERRCODE = '22023';
  END IF;

  IF v_email IS NOT NULL AND length(v_email) > 255 THEN
    RAISE EXCEPTION 'Email is too long' USING ERRCODE = '22023';
  END IF;

  IF v_receipt_footer IS NOT NULL AND length(v_receipt_footer) > 500 THEN
    RAISE EXCEPTION 'Receipt footer is too long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.branches
  SET
    display_name = v_display_name,
    phone = v_phone,
    show_logo = v_show_logo,
    logo_url = v_logo_url,
    website = v_website,
    email = v_email,
    show_website = v_show_website,
    show_email = v_show_email,
    receipt_footer = v_receipt_footer,
    show_footer = v_show_footer,
    show_cash_change = v_show_cash_change,
    print_mode = v_print_mode,
    updated_at = NOW()
  WHERE id = v_branch.id;

  PERFORM public.record_audit_event(
    'branch_invoice_settings_updated',
    v_branch.tenant_id,
    v_branch.id,
    v_user_id,
    v_profile.role,
    'branch',
    v_branch.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'branch_code', v_branch.branch_code,
      'print_mode', v_print_mode,
      'show_logo', v_show_logo,
      'show_website', v_show_website,
      'show_email', v_show_email,
      'show_footer', v_show_footer,
      'show_cash_change', v_show_cash_change,
      'has_logo_url', v_logo_url IS NOT NULL,
      'has_receipt_footer', v_receipt_footer IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'updated_at', NOW()
  );
END;
$$;


ALTER FUNCTION "public"."update_branch_invoice_settings"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_branch_invoice_settings"("p_payload" "jsonb") IS 'Safely updates invoice/receipt display settings for an authorized branch without granting direct browser UPDATE on branches.';



CREATE OR REPLACE FUNCTION "public"."update_branch_module_settings"("p_branch_id" "uuid", "p_stock_enabled" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, stock_enabled, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.branches
  SET stock_enabled = p_stock_enabled,
      updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_module_settings_updated',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_profile.role,
      'branch',
      v_branch.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'stock_enabled_before', v_branch.stock_enabled,
        'stock_enabled_after', p_stock_enabled
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'stock_enabled', p_stock_enabled,
    'updated_at', v_updated_at
  );
END;
$$;


ALTER FUNCTION "public"."update_branch_module_settings"("p_branch_id" "uuid", "p_stock_enabled" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_branch_module_settings"("p_branch_id" "uuid", "p_stock_enabled" boolean) IS 'Safely updates narrow branch module visibility settings without broad browser UPDATE access to branches.';



CREATE OR REPLACE FUNCTION "public"."update_branch_pos_settings"("p_branch_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_allow_split_payments BOOLEAN;
  v_show_pos_scroll_buttons BOOLEAN;
  v_pos_mode TEXT;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch id' USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid POS settings payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN ('allow_split_payments', 'show_pos_scroll_buttons', 'pos_mode')
  ) THEN
    RAISE EXCEPTION 'Unsupported POS setting' USING ERRCODE = '22023';
  END IF;

  IF (p_payload ? 'allow_split_payments')
     AND jsonb_typeof(p_payload -> 'allow_split_payments') <> 'boolean'
  THEN
    RAISE EXCEPTION 'allow_split_payments must be a boolean' USING ERRCODE = '22023';
  END IF;

  IF (p_payload ? 'show_pos_scroll_buttons')
     AND jsonb_typeof(p_payload -> 'show_pos_scroll_buttons') <> 'boolean'
  THEN
    RAISE EXCEPTION 'show_pos_scroll_buttons must be a boolean' USING ERRCODE = '22023';
  END IF;

  IF (p_payload ? 'pos_mode')
     AND (
       jsonb_typeof(p_payload -> 'pos_mode') <> 'string'
       OR (p_payload ->> 'pos_mode') NOT IN ('touch', 'quick')
     )
  THEN
    RAISE EXCEPTION 'pos_mode must be touch or quick' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'allow_split_payments')
     AND NOT (p_payload ? 'show_pos_scroll_buttons')
     AND NOT (p_payload ? 'pos_mode')
  THEN
    RAISE EXCEPTION 'At least one POS setting is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, allow_split_payments, show_pos_scroll_buttons, pos_mode, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_allow_split_payments := COALESCE(
    (p_payload ->> 'allow_split_payments')::boolean,
    COALESCE(v_branch.allow_split_payments, FALSE)
  );
  v_show_pos_scroll_buttons := COALESCE(
    (p_payload ->> 'show_pos_scroll_buttons')::boolean,
    COALESCE(v_branch.show_pos_scroll_buttons, FALSE)
  );
  v_pos_mode := COALESCE(
    p_payload ->> 'pos_mode',
    COALESCE(v_branch.pos_mode, 'touch')
  );

  UPDATE public.branches
  SET allow_split_payments = v_allow_split_payments,
      show_pos_scroll_buttons = v_show_pos_scroll_buttons,
      pos_mode = v_pos_mode,
      updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_pos_settings_updated',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_profile.role,
      'branch',
      v_branch.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'allow_split_payments_before', COALESCE(v_branch.allow_split_payments, FALSE),
        'allow_split_payments_after', v_allow_split_payments,
        'show_pos_scroll_buttons_before', COALESCE(v_branch.show_pos_scroll_buttons, FALSE),
        'show_pos_scroll_buttons_after', v_show_pos_scroll_buttons,
        'pos_mode_before', COALESCE(v_branch.pos_mode, 'touch'),
        'pos_mode_after', v_pos_mode
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'allow_split_payments', v_allow_split_payments,
    'show_pos_scroll_buttons', v_show_pos_scroll_buttons,
    'pos_mode', v_pos_mode,
    'updated_at', v_updated_at
  );
END;
$$;


ALTER FUNCTION "public"."update_branch_pos_settings"("p_branch_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_branch_pos_settings"("p_branch_id" "uuid", "p_payload" "jsonb") IS 'Safely updates narrow branch POS checkout settings without broad browser UPDATE access to branches.';



CREATE OR REPLACE FUNCTION "public"."update_employees_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_employees_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product_secure"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_scope RECORD;
  v_product RECORD;
  v_product_id UUID;
  v_product_id_text TEXT;
  v_category_id UUID;
  v_category_id_text TEXT;
  v_name TEXT;
  v_sku TEXT;
  v_price NUMERIC(12, 2);
  v_sort_order INTEGER;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_id',
      'name',
      'name_ar',
      'category_id',
      'description',
      'price',
      'vat_treatment',
      'image_url',
      'is_available',
      'sort_order',
      'sku',
      'notes',
      'is_service'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product field' USING ERRCODE = '22023';
  END IF;

  v_product_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'product_id', '')), '');
  IF v_product_id_text IS NULL THEN
    RAISE EXCEPTION 'Missing product id' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_product_id := v_product_id_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid product id' USING ERRCODE = '22023';
  END;

  SELECT p.*
    INTO v_product
  FROM public.products p
  WHERE p.id = v_product_id
  FOR UPDATE;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(v_product.branch_id);

  IF v_scope.tenant_id IS DISTINCT FROM v_product.tenant_id
     OR v_scope.branch_id IS DISTINCT FROM v_product.branch_id THEN
    RAISE EXCEPTION 'Product belongs to another branch' USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Product name is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'price') OR jsonb_typeof(p_payload -> 'price') <> 'number' THEN
    RAISE EXCEPTION 'Product price must be a number' USING ERRCODE = '22023';
  END IF;
  v_price := (p_payload ->> 'price')::NUMERIC(12, 2);
  IF v_price < 0 THEN
    RAISE EXCEPTION 'Product price must be zero or higher' USING ERRCODE = '22023';
  END IF;

  v_category_id_text := NULLIF(btrim(COALESCE(p_payload ->> 'category_id', '')), '');
  IF v_category_id_text IS NOT NULL THEN
    BEGIN
      v_category_id := v_category_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid category id' USING ERRCODE = '22023';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = v_category_id
        AND c.tenant_id = v_scope.tenant_id
        AND c.branch_id = v_scope.branch_id
        AND c.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Product category does not belong to this branch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_payload ? 'sku' AND NULLIF(btrim(COALESCE(p_payload ->> 'sku', '')), '') IS NOT NULL THEN
    v_sku := public.normalize_product_sku(p_payload ->> 'sku');
  ELSIF p_payload ? 'sku' THEN
    v_sku := public.next_product_sku(v_scope.tenant_id, v_name);
  ELSE
    v_sku := v_product.sku;
  END IF;

  v_sort_order := COALESCE(NULLIF(p_payload ->> 'sort_order', '')::INTEGER, 0);

  BEGIN
    UPDATE public.products
    SET name = v_name,
        name_ar = NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), ''),
        category_id = v_category_id,
        description = NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), ''),
        price = v_price,
        vat_treatment = COALESCE(NULLIF(p_payload ->> 'vat_treatment', ''), 'inherit'),
        image_url = NULLIF(btrim(COALESCE(p_payload ->> 'image_url', '')), ''),
        is_available = COALESCE((p_payload ->> 'is_available')::BOOLEAN, TRUE),
        sort_order = v_sort_order,
        sku = v_sku,
        notes = NULLIF(btrim(COALESCE(p_payload ->> 'notes', '')), ''),
        is_service = COALESCE((p_payload ->> 'is_service')::BOOLEAN, COALESCE(v_product.is_service, FALSE)),
        updated_at = NOW()
    WHERE id = v_product.id
    RETURNING sku INTO v_sku;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SKU already exists for another product in this business'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product.id,
    'sku', v_sku,
    'tenant_id', v_scope.tenant_id,
    'branch_id', v_scope.branch_id
  );
END;
$$;


ALTER FUNCTION "public"."update_product_secure"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_product_secure"("p_payload" "jsonb") IS 'Updates product details with tenant-level normalized SKU validation without touching stock quantity or cost.';



CREATE OR REPLACE FUNCTION "public"."update_product_stock_settings"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_product RECORD;
  v_product_id UUID;
  v_product_id_text TEXT;
  v_has_track_stock BOOLEAN := FALSE;
  v_has_opening_stock BOOLEAN := FALSE;
  v_has_adjustment BOOLEAN := FALSE;
  v_requested_track_stock BOOLEAN;
  v_opening_stock_quantity NUMERIC(12, 3);
  v_adjustment_quantity NUMERIC(12, 3);
  v_idempotency_key TEXT;
  v_reason TEXT;
  v_existing_movement RECORD;
  v_before_quantity NUMERIC(12, 3);
  v_after_quantity NUMERIC(12, 3);
  v_final_track_stock BOOLEAN;
  v_stock_module_enabled BOOLEAN;
  v_opening_movement_exists BOOLEAN := FALSE;
  v_movement_count INTEGER := 0;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid stock settings payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'product_id',
      'track_stock',
      'opening_stock_quantity',
      'adjustment_quantity',
      'idempotency_key',
      'reason'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported stock setting' USING ERRCODE = '22023';
  END IF;

  v_product_id_text := NULLIF(TRIM(COALESCE(p_payload ->> 'product_id', '')), '');
  IF v_product_id_text IS NULL THEN
    RAISE EXCEPTION 'Missing product id' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_product_id := v_product_id_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid product id' USING ERRCODE = '22023';
  END;

  v_has_track_stock := p_payload ? 'track_stock';
  IF v_has_track_stock AND jsonb_typeof(p_payload -> 'track_stock') <> 'boolean' THEN
    RAISE EXCEPTION 'track_stock must be a boolean' USING ERRCODE = '22023';
  END IF;

  IF v_has_track_stock THEN
    v_requested_track_stock := (p_payload ->> 'track_stock')::BOOLEAN;
  END IF;

  v_has_opening_stock := (p_payload ? 'opening_stock_quantity')
    AND jsonb_typeof(p_payload -> 'opening_stock_quantity') <> 'null';
  IF v_has_opening_stock
     AND jsonb_typeof(p_payload -> 'opening_stock_quantity') <> 'number'
  THEN
    RAISE EXCEPTION 'Opening stock must be a number' USING ERRCODE = '22023';
  END IF;

  IF v_has_opening_stock THEN
    v_opening_stock_quantity := (p_payload ->> 'opening_stock_quantity')::NUMERIC(12, 3);
    IF v_opening_stock_quantity < 0 THEN
      RAISE EXCEPTION 'Opening stock must be zero or higher' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_has_adjustment := (p_payload ? 'adjustment_quantity')
    AND jsonb_typeof(p_payload -> 'adjustment_quantity') <> 'null';
  IF v_has_adjustment
     AND jsonb_typeof(p_payload -> 'adjustment_quantity') <> 'number'
  THEN
    RAISE EXCEPTION 'Adjustment quantity must be a number' USING ERRCODE = '22023';
  END IF;

  IF v_has_adjustment THEN
    v_adjustment_quantity := (p_payload ->> 'adjustment_quantity')::NUMERIC(12, 3);
    IF v_adjustment_quantity = 0 THEN
      RAISE EXCEPTION 'Adjustment quantity cannot be zero' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  IF v_has_adjustment THEN
    IF v_idempotency_key IS NULL
       OR length(v_idempotency_key) < 8
       OR length(v_idempotency_key) > 120
    THEN
      RAISE EXCEPTION 'Valid idempotency key is required for manual stock adjustments'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION 'idempotency_key is only supported for manual stock adjustments'
      USING ERRCODE = '22023';
  END IF;

  v_reason := NULLIF(TRIM(COALESCE(p_payload ->> 'reason', '')), '');
  IF v_reason IS NOT NULL
     AND v_reason NOT IN ('opening_stock', 'manual_adjustment', 'tracking_enabled', 'tracking_disabled')
  THEN
    RAISE EXCEPTION 'Unsupported stock adjustment reason' USING ERRCODE = '22023';
  END IF;

  IF NOT v_has_track_stock AND NOT v_has_adjustment THEN
    RAISE EXCEPTION 'At least one stock setting is required' USING ERRCODE = '22023';
  END IF;

  IF v_has_adjustment AND v_has_track_stock AND v_requested_track_stock IS FALSE THEN
    RAISE EXCEPTION 'Adjust stock before disabling tracking' USING ERRCODE = '23514';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT
      p.id,
      p.tenant_id,
      p.branch_id,
      p.name,
      p.track_stock,
      p.stock_quantity,
      p.is_service,
      p.is_active,
      b.is_active AS branch_is_active,
      b.stock_enabled,
      t.is_active AS tenant_is_active,
      COALESCE(t.business_type, 'trading') AS business_type
    INTO v_product
  FROM public.products p
  JOIN public.branches b ON b.id = p.branch_id
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = v_product_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_product.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_product.tenant_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Business account is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_product.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_product.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_product.branch_id
    THEN
      RAISE EXCEPTION 'Product belongs to another branch' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Insufficient permission to update product stock' USING ERRCODE = '42501';
  END IF;

  v_final_track_stock := COALESCE(v_requested_track_stock, COALESCE(v_product.track_stock, FALSE));
  v_before_quantity := COALESCE(v_product.stock_quantity, 0);
  v_after_quantity := v_before_quantity;

  IF v_final_track_stock IS TRUE OR v_has_adjustment THEN
    IF COALESCE(v_product.business_type, 'trading') = 'service' THEN
      RAISE EXCEPTION 'Product stock tracking is not available for service businesses'
        USING ERRCODE = '23514';
    END IF;

    v_stock_module_enabled := COALESCE(v_product.stock_enabled, TRUE);
    IF v_stock_module_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Stock module is disabled for this branch'
        USING ERRCODE = '23514';
    END IF;

    IF COALESCE(v_product.is_service, FALSE) IS TRUE THEN
      RAISE EXCEPTION 'Service products cannot track stock'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_has_adjustment AND COALESCE(v_product.track_stock, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Enable stock tracking before adjusting stock'
      USING ERRCODE = '23514';
  END IF;

  IF v_has_adjustment THEN
    SELECT id, quantity_delta, created_at
      INTO v_existing_movement
    FROM public.pos_stock_movements
    WHERE tenant_id = v_product.tenant_id
      AND branch_id = v_product.branch_id
      AND product_id = v_product.id
      AND idempotency_key = v_idempotency_key
      AND reason = 'manual_adjustment'
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'product_id', v_product.id,
        'track_stock', COALESCE(v_product.track_stock, FALSE),
        'stock_quantity_before', COALESCE(v_product.stock_quantity, 0) - v_existing_movement.quantity_delta,
        'stock_quantity', COALESCE(v_product.stock_quantity, 0),
        'movement_count', 0,
        'idempotency_key', v_idempotency_key,
        'idempotent_replay', true,
        'updated_at', v_existing_movement.created_at
      );
    END IF;
  END IF;

  IF v_has_track_stock AND v_requested_track_stock IS TRUE THEN
    IF COALESCE(v_product.track_stock, FALSE) IS FALSE THEN
      IF NOT v_has_opening_stock THEN
        RAISE EXCEPTION 'Opening stock is required when enabling tracking'
          USING ERRCODE = '22023';
      END IF;

      v_after_quantity := v_opening_stock_quantity;

      SELECT EXISTS (
        SELECT 1
        FROM public.pos_stock_movements
        WHERE product_id = v_product.id
          AND tenant_id = v_product.tenant_id
          AND branch_id = v_product.branch_id
          AND reason = 'opening_stock'
      )
        INTO v_opening_movement_exists;

      UPDATE public.products
      SET track_stock = TRUE,
          stock_quantity = v_after_quantity,
          updated_at = v_updated_at
      WHERE id = v_product.id;

      IF v_opening_movement_exists IS FALSE THEN
        INSERT INTO public.pos_stock_movements (
          tenant_id,
          branch_id,
          product_id,
          invoice_id,
          quantity_delta,
          reason,
          created_by,
          created_at
        ) VALUES (
          v_product.tenant_id,
          v_product.branch_id,
          v_product.id,
          NULL,
          v_after_quantity - v_before_quantity,
          'opening_stock',
          v_user_id,
          v_updated_at
        );
        v_movement_count := v_movement_count + 1;
      ELSIF v_after_quantity IS DISTINCT FROM v_before_quantity THEN
        INSERT INTO public.pos_stock_movements (
          tenant_id,
          branch_id,
          product_id,
          invoice_id,
          quantity_delta,
          reason,
          created_by,
          created_at
        ) VALUES (
          v_product.tenant_id,
          v_product.branch_id,
          v_product.id,
          NULL,
          v_after_quantity - v_before_quantity,
          'manual_adjustment',
          v_user_id,
          v_updated_at
        );
        v_movement_count := v_movement_count + 1;
      END IF;
    ELSE
      IF v_has_opening_stock AND v_opening_stock_quantity IS DISTINCT FROM v_before_quantity THEN
        RAISE EXCEPTION 'Use Adjust Stock to change stock for an already tracked product'
          USING ERRCODE = '23514';
      END IF;

      UPDATE public.products
      SET track_stock = TRUE,
          updated_at = v_updated_at
      WHERE id = v_product.id;
    END IF;
  ELSIF v_has_track_stock AND v_requested_track_stock IS FALSE THEN
    UPDATE public.products
    SET track_stock = FALSE,
        updated_at = v_updated_at
    WHERE id = v_product.id;

    v_final_track_stock := FALSE;
    v_after_quantity := v_before_quantity;
  END IF;

  IF v_has_adjustment THEN
    v_after_quantity := v_after_quantity + v_adjustment_quantity;

    IF v_after_quantity < 0 THEN
      RAISE EXCEPTION 'Adjustment would make stock negative' USING ERRCODE = '23514';
    END IF;

    UPDATE public.products
    SET stock_quantity = v_after_quantity,
        updated_at = v_updated_at
    WHERE id = v_product.id;

    INSERT INTO public.pos_stock_movements (
      tenant_id,
      branch_id,
      product_id,
      invoice_id,
      quantity_delta,
      reason,
      created_by,
      created_at,
      idempotency_key
    ) VALUES (
      v_product.tenant_id,
      v_product.branch_id,
      v_product.id,
      NULL,
      v_adjustment_quantity,
      'manual_adjustment',
      v_user_id,
      v_updated_at,
      v_idempotency_key
    );

    v_movement_count := v_movement_count + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_product.id,
    'track_stock', v_final_track_stock,
    'stock_quantity_before', v_before_quantity,
    'stock_quantity', v_after_quantity,
    'movement_count', v_movement_count,
    'idempotency_key', v_idempotency_key,
    'idempotent_replay', false,
    'updated_at', v_updated_at
  );
END;
$$;


ALTER FUNCTION "public"."update_product_stock_settings"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_product_stock_settings"("p_payload" "jsonb") IS 'Safely updates POS product stock tracking and audited stock quantity changes without broad browser stock writes.';



CREATE OR REPLACE FUNCTION "public"."update_purchase_entry"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_purchase_id UUID;
  v_supplier_id UUID;
  v_purchase_date DATE;
  v_bill_number TEXT;
  v_tax_mode TEXT;
  v_payment_status TEXT;
  v_payment_method TEXT;
  v_notes TEXT;
  v_bill_url TEXT;
  v_amount NUMERIC(12, 2);
  v_subtotal NUMERIC(12, 2);
  v_vat_amount NUMERIC(12, 2);
  v_total_amount NUMERIC(12, 2);
  v_items JSONB;
  v_item JSONB;
  v_item_count INTEGER := 0;
  v_line_name TEXT;
  v_inventory_item_id UUID;
  v_quantity NUMERIC(12, 3);
  v_unit_cost NUMERIC(12, 2);
  v_line_total NUMERIC(12, 2);
  v_raw_line_total NUMERIC(12, 2) := 0;
  v_supplier_id_text TEXT;
  v_inventory_id_text TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid purchase payload' USING ERRCODE = '22023';
  END IF;

  v_purchase_id := NULLIF(TRIM(COALESCE(p_payload ->> 'purchase_id', '')), '')::uuid;

  IF v_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = v_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to edit this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to edit this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to edit this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.status, 'posted') = 'cancelled'
     OR COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('confirmed', 'cancelled', 'reversed', 'confirmed_legacy')
  THEN
    RAISE EXCEPTION 'This purchase can no longer be edited.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('simple_bill', 'detailed_receiving') THEN
    RAISE EXCEPTION 'Unsupported purchase mode' USING ERRCODE = '23514';
  END IF;

  v_tax_mode := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'tax_input_mode', '')), ''), v_purchase.tax_input_mode, 'included');
  IF v_tax_mode NOT IN ('included', 'excluded') THEN
    RAISE EXCEPTION 'VAT mode must be included or excluded' USING ERRCODE = '22023';
  END IF;

  v_payment_status := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'payment_status', '')), ''), v_purchase.payment_status, 'paid');
  IF v_payment_status NOT IN ('paid', 'unpaid', 'partial') THEN
    RAISE EXCEPTION 'Invalid payment status' USING ERRCODE = '22023';
  END IF;

  v_payment_method := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'payment_method', '')), ''), v_purchase.payment_method, 'cash');
  IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method' USING ERRCODE = '22023';
  END IF;

  v_purchase_date := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'purchase_date', '')), '')::date, v_purchase.purchase_date);
  v_bill_number := NULLIF(TRIM(COALESCE(p_payload ->> 'bill_number', '')), '');
  v_notes := NULLIF(TRIM(COALESCE(p_payload ->> 'notes', '')), '');
  v_bill_url := NULLIF(TRIM(COALESCE(p_payload ->> 'bill_url', '')), '');

  IF p_payload ? 'supplier_id' THEN
    v_supplier_id_text := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_id', '')), '');
    v_supplier_id := v_supplier_id_text::uuid;
  ELSE
    v_supplier_id := v_purchase.supplier_id;
  END IF;

  IF v_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = v_supplier_id
      AND s.tenant_id = v_purchase.tenant_id
  ) THEN
    RAISE EXCEPTION 'Supplier not found for this tenant' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') = 'simple_bill' THEN
    v_amount := NULLIF(TRIM(COALESCE(p_payload ->> 'amount', '')), '')::numeric;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Purchase amount must be greater than zero' USING ERRCODE = '22023';
    END IF;

    IF v_tax_mode = 'included' THEN
      v_total_amount := round(v_amount, 2);
      v_vat_amount := round(v_total_amount * 15 / 115, 2);
      v_subtotal := round(v_total_amount - v_vat_amount, 2);
    ELSE
      v_subtotal := round(v_amount, 2);
      v_vat_amount := round(v_subtotal * 0.15, 2);
      v_total_amount := round(v_subtotal + v_vat_amount, 2);
    END IF;

    IF EXISTS (SELECT 1 FROM public.purchase_items pi WHERE pi.purchase_id = v_purchase.id) THEN
      RAISE EXCEPTION 'This simple bill has item lines and cannot be edited here.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.purchases
    SET supplier_id = v_supplier_id,
        purchase_date = v_purchase_date,
        bill_number = v_bill_number,
        tax_input_mode = v_tax_mode,
        payment_status = v_payment_status,
        subtotal = v_subtotal,
        vat_amount = v_vat_amount,
        total_amount = v_total_amount,
        payment_method = v_payment_method,
        bill_url = CASE WHEN p_payload ? 'bill_url' THEN v_bill_url ELSE bill_url END,
        notes = v_notes,
        updated_at = NOW()
    WHERE id = v_purchase.id;

    PERFORM public.record_audit_event(
      'purchase_bill_updated',
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_user_id,
      v_profile.role,
      'purchase',
      v_purchase.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', v_purchase.purchase_mode,
        'tax_input_mode', v_tax_mode,
        'payment_status', v_payment_status,
        'total_amount', v_total_amount,
        'has_bill_number', v_bill_number IS NOT NULL,
        'has_bill_url', COALESCE(v_bill_url, v_purchase.bill_url) IS NOT NULL
      ),
      NULL,
      NULL
    );
  ELSE
    IF COALESCE(v_purchase.receiving_status, 'not_applicable') NOT IN ('draft', 'pending_confirmation') THEN
      RAISE EXCEPTION 'Only pending stock purchases can be edited.'
        USING ERRCODE = '23514';
    END IF;

    v_items := COALESCE(p_payload -> 'items', '[]'::jsonb);
    IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
      RAISE EXCEPTION 'Add at least one item before saving this purchase.'
        USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.purchase_items
    WHERE purchase_id = v_purchase.id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_name := NULLIF(TRIM(COALESCE(v_item ->> 'name', '')), '');
      v_inventory_id_text := NULLIF(TRIM(COALESCE(v_item ->> 'inventory_item_id', '')), '');
      v_inventory_item_id := v_inventory_id_text::uuid;
      v_quantity := NULLIF(TRIM(COALESCE(v_item ->> 'quantity', '')), '')::numeric;
      v_unit_cost := COALESCE(NULLIF(TRIM(COALESCE(v_item ->> 'unit_cost', '')), '')::numeric, 0);

      IF v_line_name IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'Each item needs a name and quantity greater than zero.'
          USING ERRCODE = '22023';
      END IF;

      IF v_unit_cost < 0 THEN
        RAISE EXCEPTION 'Unit cost cannot be negative' USING ERRCODE = '22023';
      END IF;

      IF v_inventory_item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_items ii
        WHERE ii.id = v_inventory_item_id
          AND ii.tenant_id = v_purchase.tenant_id
          AND ii.branch_id = v_purchase.branch_id
      ) THEN
        RAISE EXCEPTION 'Linked stock item was not found in this branch.'
          USING ERRCODE = '23514';
      END IF;

      v_line_total := round(v_quantity * v_unit_cost, 2);
      v_raw_line_total := v_raw_line_total + v_line_total;
      v_item_count := v_item_count + 1;

      INSERT INTO public.purchase_items (
        purchase_id,
        inventory_item_id,
        name,
        supplier_item_name,
        line_type,
        receiving_status,
        received_quantity,
        match_source,
        quantity,
        unit_cost,
        total
      ) VALUES (
        v_purchase.id,
        v_inventory_item_id,
        v_line_name,
        v_line_name,
        CASE WHEN v_inventory_item_id IS NULL THEN 'non_stock' ELSE 'stock' END,
        'pending',
        0,
        CASE WHEN v_inventory_item_id IS NULL THEN 'none' ELSE 'manual' END,
        v_quantity,
        v_unit_cost,
        v_line_total
      );
    END LOOP;

    IF v_tax_mode = 'included' THEN
      v_total_amount := round(v_raw_line_total, 2);
      v_vat_amount := round(v_total_amount * 15 / 115, 2);
      v_subtotal := round(v_total_amount - v_vat_amount, 2);
    ELSE
      v_subtotal := round(v_raw_line_total, 2);
      v_vat_amount := round(v_subtotal * 0.15, 2);
      v_total_amount := round(v_subtotal + v_vat_amount, 2);
    END IF;

    UPDATE public.purchases
    SET supplier_id = v_supplier_id,
        purchase_date = v_purchase_date,
        bill_number = v_bill_number,
        tax_input_mode = v_tax_mode,
        payment_status = v_payment_status,
        subtotal = v_subtotal,
        vat_amount = v_vat_amount,
        total_amount = v_total_amount,
        payment_method = v_payment_method,
        bill_url = CASE WHEN p_payload ? 'bill_url' THEN v_bill_url ELSE bill_url END,
        notes = v_notes,
        status = 'draft',
        receiving_status = 'pending_confirmation',
        updated_at = NOW()
    WHERE id = v_purchase.id;

    PERFORM public.record_audit_event(
      'purchase_receiving_updated',
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_user_id,
      v_profile.role,
      'purchase',
      v_purchase.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', v_purchase.purchase_mode,
        'tax_input_mode', v_tax_mode,
        'payment_status', v_payment_status,
        'line_count', v_item_count,
        'total_amount', v_total_amount,
        'has_bill_number', v_bill_number IS NOT NULL,
        'has_bill_url', COALESCE(v_bill_url, v_purchase.bill_url) IS NOT NULL
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'purchase_mode', v_purchase.purchase_mode,
    'subtotal', v_subtotal,
    'vat_amount', v_vat_amount,
    'total_amount', v_total_amount
  );
END;
$$;


ALTER FUNCTION "public"."update_purchase_entry"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_purchase_entry"("p_payload" "jsonb") IS 'Safely edits simple purchase bills and pending receive-stock purchases within the 45-day edit window.';



CREATE OR REPLACE FUNCTION "public"."update_tenant_last_active"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE tenants
     SET last_active_at = now()
   WHERE id = NEW.tenant_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_tenant_last_active"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_supplier_item_mapping"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_supplier_id UUID;
  v_branch_id UUID;
  v_inventory_item_id UUID;
  v_supplier_item_name TEXT;
  v_normalized TEXT;
  v_mapping RECORD;
  v_action TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid mapping payload' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  v_supplier_id := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_id', '')), '')::uuid;
  v_branch_id := COALESCE(
    NULLIF(TRIM(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid,
    v_profile.branch_id
  );
  v_inventory_item_id := NULLIF(TRIM(COALESCE(p_payload ->> 'matched_inventory_item_id', '')), '')::uuid;
  v_supplier_item_name := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_item_name', '')), '');
  v_normalized := public.normalize_supplier_item_name(v_supplier_item_name);

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier is required' USING ERRCODE = '22023';
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for inventory item mappings' USING ERRCODE = '22023';
  END IF;

  IF v_inventory_item_id IS NULL THEN
    RAISE EXCEPTION 'Inventory item is required' USING ERRCODE = '22023';
  END IF;

  IF v_supplier_item_name IS NULL OR v_normalized IS NULL THEN
    RAISE EXCEPTION 'Supplier item name is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_supplier_item_name) > 500 THEN
    RAISE EXCEPTION 'Supplier item name is too long' USING ERRCODE = '22023';
  END IF;

  IF v_profile.role = 'owner' THEN
    NULL;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.branch_id IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'You do not have permission to update mappings for this branch.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to update supplier item mappings.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = v_supplier_id
      AND s.tenant_id = v_profile.tenant_id
  ) THEN
    RAISE EXCEPTION 'Supplier not found for this tenant' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = v_branch_id
      AND b.tenant_id = v_profile.tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch not found for this tenant' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_items ii
    WHERE ii.id = v_inventory_item_id
      AND ii.tenant_id = v_profile.tenant_id
      AND ii.branch_id = v_branch_id
  ) THEN
    RAISE EXCEPTION 'Inventory item not found in this branch' USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_mapping
  FROM public.supplier_item_mappings m
  WHERE m.tenant_id = v_profile.tenant_id
    AND m.supplier_id = v_supplier_id
    AND m.normalized_supplier_item_name = v_normalized
    AND m.branch_id IS NOT DISTINCT FROM v_branch_id
  ORDER BY m.is_active DESC, m.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.supplier_item_mappings
    SET supplier_item_name = v_supplier_item_name,
        normalized_supplier_item_name = v_normalized,
        normalized_name = v_normalized,
        matched_inventory_item_id = v_inventory_item_id,
        matched_product_id = NULL,
        confidence = 1.00,
        match_confidence = 1.00,
        match_source = 'manual',
        confirmation_status = 'manual_confirmed',
        is_active = TRUE,
        confirmed_by = v_user_id,
        confirmed_at = NOW(),
        last_used_at = NOW(),
        updated_at = NOW()
    WHERE id = v_mapping.id
    RETURNING * INTO v_mapping;

    v_action := 'supplier_item_mapping_updated';
  ELSE
    INSERT INTO public.supplier_item_mappings (
      tenant_id,
      branch_id,
      supplier_id,
      supplier_item_name,
      normalized_supplier_item_name,
      normalized_name,
      matched_inventory_item_id,
      matched_product_id,
      confidence,
      match_confidence,
      match_source,
      confirmation_status,
      is_active,
      confirmed_by,
      confirmed_at,
      last_used_at
    ) VALUES (
      v_profile.tenant_id,
      v_branch_id,
      v_supplier_id,
      v_supplier_item_name,
      v_normalized,
      v_normalized,
      v_inventory_item_id,
      NULL,
      1.00,
      1.00,
      'manual',
      'manual_confirmed',
      TRUE,
      v_user_id,
      NOW(),
      NOW()
    )
    RETURNING * INTO v_mapping;

    v_action := 'supplier_item_mapping_created';
  END IF;

  PERFORM public.record_audit_event(
    v_action,
    v_profile.tenant_id,
    v_branch_id,
    v_user_id,
    v_profile.role,
    'supplier_item_mapping',
    v_mapping.id,
    'info',
    'succeeded',
    jsonb_build_object(
      'supplier_id', v_supplier_id,
      'matched_inventory_item_id', v_inventory_item_id,
      'match_source', 'manual',
      'branch_specific', v_branch_id IS NOT NULL
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'mapping_id', v_mapping.id,
    'supplier_id', v_supplier_id,
    'matched_inventory_item_id', v_inventory_item_id,
    'match_source', 'manual'
  );
END;
$$;


ALTER FUNCTION "public"."upsert_supplier_item_mapping"("p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_branch_login_username_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.username := public.normalize_branch_login_username(NEW.username);
  NEW.normalized_username := public.normalize_branch_login_username(NEW.normalized_username);
  NEW.internal_auth_email := lower(btrim(NEW.internal_auth_email));

  IF NEW.username <> NEW.normalized_username THEN
    RAISE EXCEPTION 'Branch username must match normalized username' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = NEW.branch_id
      AND b.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Branch username branch/tenant mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = NEW.user_id
      AND up.tenant_id = NEW.tenant_id
      AND up.branch_id = NEW.branch_id
      AND up.role::text = 'branch'
  ) THEN
    RAISE EXCEPTION 'Branch username user/branch mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = NEW.user_id
      AND lower(COALESCE(au.email, '')) = NEW.internal_auth_email
  ) THEN
    RAISE EXCEPTION 'Branch username auth email/user mismatch' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_branch_login_username_scope"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_branch_login_username_scope"() IS 'Normalizes branch login username rows and validates tenant/branch/user profile consistency before writes.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "branch_id" "uuid",
    "actor_user_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "target_type" "text",
    "target_id" "uuid",
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "status" "text" DEFAULT 'attempted'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip_hash" "text",
    "request_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_events_severity_check" CHECK (("severity" = ANY (ARRAY['debug'::"text", 'info'::"text", 'warning'::"text", 'error'::"text", 'critical'::"text"]))),
    CONSTRAINT "audit_events_status_check" CHECK (("status" = ANY (ARRAY['attempted'::"text", 'succeeded'::"text", 'failed'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."audit_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_events" IS 'Safe security/audit event log. Do not store secrets, OTPs, auth headers, private keys, raw XML, or full request bodies.';



CREATE TABLE IF NOT EXISTS "public"."branch_login_usernames" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "normalized_username" "text" NOT NULL,
    "internal_auth_email" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "branch_login_usernames_internal_email_format" CHECK (("internal_auth_email" ~ '^[a-z0-9][a-z0-9._%+-]*@branch-login\.kubri\.internal$'::"text")),
    CONSTRAINT "branch_login_usernames_internal_email_no_empty" CHECK (("length"("btrim"("internal_auth_email")) > 0)),
    CONSTRAINT "branch_login_usernames_normalized_is_normalized" CHECK (("public"."normalize_branch_login_username"("normalized_username") = "normalized_username")),
    CONSTRAINT "branch_login_usernames_username_matches_normalized" CHECK (("public"."normalize_branch_login_username"("username") = "normalized_username")),
    CONSTRAINT "branch_login_usernames_username_valid" CHECK ("public"."is_valid_branch_login_username"("normalized_username"))
);


ALTER TABLE "public"."branch_login_usernames" OWNER TO "postgres";


COMMENT ON TABLE "public"."branch_login_usernames" IS 'Maps globally unique branch login usernames to generated internal Supabase Auth emails.';



COMMENT ON COLUMN "public"."branch_login_usernames"."username" IS 'Canonical branch login username stored lowercase during Phase 3B.';



COMMENT ON COLUMN "public"."branch_login_usernames"."normalized_username" IS 'Trimmed lowercase username used for unique lookup and resolver matching.';



COMMENT ON COLUMN "public"."branch_login_usernames"."internal_auth_email" IS 'Generated internal Supabase Auth email for username/password branch login; do not show to branch users.';



CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "branch_code" character varying(50),
    "phone" character varying(20),
    "email" character varying(255),
    "address" "text",
    "address_ar" "text",
    "building_number" character varying(10),
    "additional_number" character varying(10),
    "street" character varying(255),
    "street_ar" character varying(255),
    "district" character varying(100),
    "district_ar" character varying(100),
    "city" character varying(100),
    "city_ar" character varying(100),
    "country" character(2) DEFAULT 'SA'::"bpchar",
    "postal_code" character varying(10),
    "is_main_branch" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "invoice_counter" bigint DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "business_name" character varying(255),
    "business_name_ar" character varying(255),
    "vat_number" character varying(15),
    "cr_number" character varying(20),
    "logo_url" "text",
    "website" character varying(255),
    "vat_mode" character varying(20) DEFAULT 'exclusive'::character varying,
    "invoice_prefix" character varying(10) DEFAULT 'INV'::character varying,
    "receipt_footer" "text",
    "show_logo" boolean DEFAULT true,
    "invoice_language" character varying(10) DEFAULT 'both'::character varying,
    "zatca_phase" smallint DEFAULT 1,
    "branch_email" "text",
    "display_name" "text",
    "show_website" boolean DEFAULT false NOT NULL,
    "show_email" boolean DEFAULT false NOT NULL,
    "show_footer" boolean DEFAULT true NOT NULL,
    "show_cash_change" boolean DEFAULT true NOT NULL,
    "print_mode" "text" DEFAULT 'thermal'::"text" NOT NULL,
    "credit_note_counter" bigint DEFAULT 0 NOT NULL,
    "allow_split_payments" boolean DEFAULT false NOT NULL,
    "show_pos_scroll_buttons" boolean DEFAULT false NOT NULL,
    "stock_enabled" boolean,
    "pos_mode" "text" DEFAULT 'touch'::"text" NOT NULL,
    CONSTRAINT "branches_invoice_language_check" CHECK ((("invoice_language")::"text" = ANY ((ARRAY['en'::character varying, 'ar'::character varying, 'both'::character varying])::"text"[]))),
    CONSTRAINT "branches_pos_mode_check" CHECK (("pos_mode" = ANY (ARRAY['touch'::"text", 'quick'::"text"]))),
    CONSTRAINT "branches_print_mode_check" CHECK (("print_mode" = ANY (ARRAY['thermal'::"text", 'pdf'::"text", 'both'::"text"]))),
    CONSTRAINT "branches_vat_mode_check" CHECK ((("vat_mode")::"text" = ANY ((ARRAY['exclusive'::character varying, 'inclusive'::character varying])::"text"[]))),
    CONSTRAINT "branches_zatca_phase_check" CHECK (("zatca_phase" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."branches"."branch_email" IS 'Email address of the branch POS login account (set during branch creation)';



COMMENT ON COLUMN "public"."branches"."display_name" IS 'Optional UI display name override — shown on invoice headers; QR tag 1 always uses business_name';



COMMENT ON COLUMN "public"."branches"."show_website" IS 'Whether to print website URL on invoices';



COMMENT ON COLUMN "public"."branches"."show_email" IS 'Whether to print email on invoices';



COMMENT ON COLUMN "public"."branches"."show_footer" IS 'Whether to print the receipt_footer text on receipts';



COMMENT ON COLUMN "public"."branches"."show_cash_change" IS 'Whether to print change amount on cash receipts';



COMMENT ON COLUMN "public"."branches"."print_mode" IS 'Default print format shown after each POS sale: thermal | pdf | both';



COMMENT ON COLUMN "public"."branches"."credit_note_counter" IS 'Thread-safe branch-local human credit note counter. ZATCA ICV remains zatca_counter_number.';



COMMENT ON COLUMN "public"."branches"."allow_split_payments" IS 'Branch-level POS checkout setting. When true, POS may split one invoice across cash and card payment rows.';



COMMENT ON COLUMN "public"."branches"."show_pos_scroll_buttons" IS 'Shows large optional POS category/product arrow buttons for touch-screen navigation.';



COMMENT ON COLUMN "public"."branches"."stock_enabled" IS 'Nullable Stock module override. NULL follows tenant business_type default; TRUE enables Stock; FALSE disables Stock.';



COMMENT ON COLUMN "public"."branches"."pos_mode" IS 'Controls which POS billing interface a branch uses: touch or quick.';



CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "description" "text",
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "color" character varying(20) DEFAULT '#6b7280'::character varying,
    "icon" character varying(10) DEFAULT '📦'::character varying,
    "branch_id" "uuid" NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "customer_type" character varying(20) DEFAULT 'individual'::character varying,
    "vat_number" character varying(15),
    "cr_number" character varying(20),
    "email" character varying(255),
    "phone" character varying(20),
    "address" "text",
    "address_ar" "text",
    "building_number" character varying(10),
    "additional_number" character varying(10),
    "district" character varying(100),
    "city" character varying(100),
    "country" character(2) DEFAULT 'SA'::"bpchar",
    "postal_code" character varying(10),
    "notes" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "company_name" character varying(255),
    "business_name" "text",
    "business_name_ar" "text",
    "branch_id" "uuid" NOT NULL
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."day_closings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "closing_date" "date" NOT NULL,
    "total_sales" numeric(10,2) DEFAULT 0 NOT NULL,
    "cash_sales" numeric(10,2) DEFAULT 0 NOT NULL,
    "card_sales" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_vat" numeric(10,2) DEFAULT 0 NOT NULL,
    "invoice_count" integer DEFAULT 0 NOT NULL,
    "total_expenses" numeric(10,2) DEFAULT 0 NOT NULL,
    "cash_expenses" numeric(10,2) DEFAULT 0 NOT NULL,
    "card_expenses" numeric(10,2) DEFAULT 0 NOT NULL,
    "expected_cash" numeric(10,2) DEFAULT 0 NOT NULL,
    "actual_cash" numeric(10,2) DEFAULT 0 NOT NULL,
    "cash_difference" numeric(10,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "closed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."day_closings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "user_id" "uuid",
    "full_name" character varying(255) NOT NULL,
    "full_name_ar" character varying(255),
    "national_id" character varying(20),
    "iqama_number" character varying(20),
    "email" character varying(255),
    "phone" character varying(20),
    "position" character varying(100),
    "position_ar" character varying(100),
    "department" character varying(100),
    "department_ar" character varying(100),
    "salary" numeric(12,2),
    "hire_date" "date",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_categories" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid",
    "name" character varying(100) NOT NULL,
    "name_ar" character varying(100),
    "color" character varying(20) DEFAULT '#6b7280'::character varying,
    "icon" character varying(10) DEFAULT '💰'::character varying,
    "is_system" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."expense_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "added_by" "uuid",
    "expense_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "description" character varying(500) NOT NULL,
    "vendor_name" character varying(255),
    "amount" numeric(12,2) NOT NULL,
    "vat_treatment" character varying(20) DEFAULT 'no_vat'::character varying NOT NULL,
    "vat_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_paid" numeric(12,2) DEFAULT 0 NOT NULL,
    "payment_method" character varying(20) DEFAULT 'cash'::character varying NOT NULL,
    "receipt_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "session_id" "uuid",
    "vat_claim_status" "text",
    "expense_before_vat" numeric(12,2),
    "tax_invoice_number" "text",
    "supplier_vat_number" "text",
    "supplier_id" "uuid",
    "supplier_cr_number" "text",
    "supplier_contact" "text",
    "invoice_time" time without time zone,
    CONSTRAINT "expenses_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "expenses_payment_method_check" CHECK ((("payment_method")::"text" = ANY ((ARRAY['cash'::character varying, 'card'::character varying, 'bank_transfer'::character varying, 'other'::character varying])::"text"[]))),
    CONSTRAINT "expenses_total_paid_check" CHECK (("total_paid" >= (0)::numeric)),
    CONSTRAINT "expenses_vat_amount_check" CHECK (("vat_amount" >= (0)::numeric)),
    CONSTRAINT "expenses_vat_treatment_check" CHECK ((("vat_treatment")::"text" = ANY ((ARRAY['no_vat'::character varying, 'included'::character varying, 'on_top'::character varying])::"text"[])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."expenses"."amount" IS 'Expense amount before claimable VAT for new Phase 5B-3C rows; legacy rows may have stored the entered amount.';



COMMENT ON COLUMN "public"."expenses"."total_paid" IS 'Actual amount paid by cash/card/bank. Cash drawer and expense totals use this value.';



COMMENT ON COLUMN "public"."expenses"."vat_claim_status" IS 'Expense VAT status: no_vat, claimable, not_claimable, or needs_review. Only claimable feeds expense input VAT.';



COMMENT ON COLUMN "public"."expenses"."expense_before_vat" IS 'Expense amount excluding claimable VAT. For no-VAT/not-claimable rows this should equal total_paid.';



COMMENT ON COLUMN "public"."expenses"."tax_invoice_number" IS 'Optional supplier tax invoice number for manually-entered claimable expenses.';



COMMENT ON COLUMN "public"."expenses"."supplier_vat_number" IS 'Optional supplier VAT number for manually-entered claimable expenses.';



COMMENT ON COLUMN "public"."expenses"."supplier_id" IS 'Optional branch supplier link. Vendor and registration fields remain point-in-time snapshots.';



COMMENT ON COLUMN "public"."expenses"."supplier_cr_number" IS 'Optional supplier commercial-registration snapshot from the supporting document.';



COMMENT ON COLUMN "public"."expenses"."supplier_contact" IS 'Optional supplier contact snapshot relevant to the expense record.';



COMMENT ON COLUMN "public"."expenses"."invoice_time" IS 'Optional time printed on the supplier tax invoice; expense_date remains the single accounting date.';



CREATE TABLE IF NOT EXISTS "public"."fixed_expenses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "name" character varying(255) NOT NULL,
    "monthly_amount" numeric(12,2) NOT NULL,
    "payment_method" character varying(20) DEFAULT 'cash'::character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "fixed_expenses_monthly_amount_check" CHECK (("monthly_amount" >= (0)::numeric)),
    CONSTRAINT "fixed_expenses_payment_method_check" CHECK ((("payment_method")::"text" = ANY ((ARRAY['cash'::character varying, 'card'::character varying, 'bank_transfer'::character varying, 'other'::character varying])::"text"[])))
);


ALTER TABLE "public"."fixed_expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "supplier_id" "uuid",
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "unit_type" character varying(20) DEFAULT 'pieces'::character varying NOT NULL,
    "current_quantity" numeric(12,3) DEFAULT 0 NOT NULL,
    "minimum_quantity" numeric(12,3) DEFAULT 0 NOT NULL,
    "unit_cost" numeric(12,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "inventory_items_unit_type_check" CHECK ((("unit_type")::"text" = ANY ((ARRAY['pieces'::character varying, 'kg'::character varying, 'grams'::character varying, 'liters'::character varying, 'ml'::character varying, 'boxes'::character varying, 'bags'::character varying, 'other'::character varying])::"text"[])))
);


ALTER TABLE "public"."inventory_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "description" "text",
    "sku" character varying(100),
    "unit" character varying(50),
    "quantity" numeric(12,3) DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "discount_percent" numeric(5,2) DEFAULT 0,
    "discount_amount" numeric(12,2) DEFAULT 0,
    "subtotal" numeric(12,2) NOT NULL,
    "tax_rate" numeric(5,2) DEFAULT 15.00,
    "tax_category" character varying(10) DEFAULT 'S'::character varying,
    "tax_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "original_invoice_item_id" "uuid"
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."invoice_items"."original_invoice_item_id" IS 'For credit/debit note lines, references the original invoice item being credited.';



CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "created_by" "uuid",
    "invoice_number" character varying(50) NOT NULL,
    "invoice_reference" character varying(100),
    "zatca_uuid" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "zatca_invoice_type" "public"."invoice_type" DEFAULT 'simplified'::"public"."invoice_type" NOT NULL,
    "zatca_type_code" character varying(10) DEFAULT '388'::character varying,
    "zatca_counter_number" bigint,
    "zatca_prev_invoice_hash" "text",
    "zatca_xml" "text",
    "zatca_xml_hash" "text",
    "zatca_signature" "text",
    "zatca_qr_code" "text",
    "zatca_status" "public"."zatca_status" DEFAULT 'not_submitted'::"public"."zatca_status",
    "zatca_submission_id" character varying(255),
    "zatca_submitted_at" timestamp with time zone,
    "zatca_clearance_status" character varying(50),
    "zatca_clearance_response" "jsonb",
    "zatca_reporting_response" "jsonb",
    "zatca_warnings" "jsonb",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(12,2) DEFAULT 0,
    "taxable_amount" numeric(12,2) DEFAULT 0,
    "tax_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency_code" character(3) DEFAULT 'SAR'::"bpchar",
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "supply_date" "date",
    "due_date" "date",
    "status" "public"."invoice_status" DEFAULT 'draft'::"public"."invoice_status",
    "payment_status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status",
    "notes" "text",
    "notes_ar" "text",
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "session_id" "uuid",
    "payment_method" "public"."payment_method" DEFAULT 'cash'::"public"."payment_method",
    "checkout_idempotency_key" "text",
    "original_invoice_id" "uuid",
    "credit_reason" "text",
    "credit_note_idempotency_key" "text"
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


COMMENT ON COLUMN "public"."invoices"."original_invoice_id" IS 'For credit/debit notes, references the original invoice document being corrected.';



COMMENT ON COLUMN "public"."invoices"."credit_reason" IS 'Human-readable reason for issuing a credit/debit note. Used in ZATCA credit note XML.';



COMMENT ON COLUMN "public"."invoices"."credit_note_idempotency_key" IS 'Client-generated idempotency key for backend-controlled credit note creation.';



CREATE TABLE IF NOT EXISTS "public"."manual_subscription_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "subscription_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'SAR'::"text" NOT NULL,
    "plan_interval" "text" NOT NULL,
    "paid_branch_count" integer NOT NULL,
    "price_per_branch" numeric(12,2),
    "payment_method" "text",
    "payment_reference" "text",
    "payment_received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "coverage_start_date" "date" NOT NULL,
    "coverage_end_date" "date" NOT NULL,
    "next_due_date" "date" NOT NULL,
    "grace_until_date" "date" NOT NULL,
    "status" "text" DEFAULT 'manual_verified'::"text" NOT NULL,
    "money_back_until_date" "date",
    "notes" "text",
    "verified_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "manual_subscription_payments_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "manual_subscription_payments_coverage_dates_check" CHECK (("coverage_end_date" >= "coverage_start_date")),
    CONSTRAINT "manual_subscription_payments_currency_check" CHECK ((("currency" = "upper"("currency")) AND ("length"("currency") = 3))),
    CONSTRAINT "manual_subscription_payments_due_date_check" CHECK (("next_due_date" >= "coverage_end_date")),
    CONSTRAINT "manual_subscription_payments_grace_date_check" CHECK (("grace_until_date" = ("next_due_date" + 7))),
    CONSTRAINT "manual_subscription_payments_paid_branch_count_check" CHECK (("paid_branch_count" >= 1)),
    CONSTRAINT "manual_subscription_payments_plan_interval_check" CHECK (("plan_interval" = ANY (ARRAY['monthly'::"text", 'yearly'::"text", 'manual'::"text", 'custom'::"text", 'lifetime'::"text"]))),
    CONSTRAINT "manual_subscription_payments_price_per_branch_check" CHECK ((("price_per_branch" IS NULL) OR ("price_per_branch" >= (0)::numeric))),
    CONSTRAINT "manual_subscription_payments_status_check" CHECK (("status" = ANY (ARRAY['unpaid'::"text", 'manual_verified'::"text", 'overdue'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."manual_subscription_payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."manual_subscription_payments" IS 'Manual ledger of offline Kubri subscription payments before payment gateway integration.';



COMMENT ON COLUMN "public"."manual_subscription_payments"."payment_reference" IS 'Manual payment proof/reference. Do not store card data or sensitive bank credentials.';



CREATE TABLE IF NOT EXISTS "public"."payment_refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "original_invoice_id" "uuid" NOT NULL,
    "credit_note_invoice_id" "uuid" NOT NULL,
    "payment_id" "uuid",
    "method" "public"."payment_method" DEFAULT 'cash'::"public"."payment_method" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_refunds_amount_positive" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payment_refunds_distinct_documents" CHECK (("original_invoice_id" <> "credit_note_invoice_id")),
    CONSTRAINT "payment_refunds_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payment_refunds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "recorded_by" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "amount_received" numeric(12,2),
    "change_amount" numeric(12,2),
    "method" "public"."payment_method" DEFAULT 'cash'::"public"."payment_method" NOT NULL,
    "reference" character varying(255),
    "notes" "text",
    "paid_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payments"."amount_received" IS 'Customer tendered amount captured at POS checkout. For card/bank payments this normally equals the invoice total.';



COMMENT ON COLUMN "public"."payments"."change_amount" IS 'Cash change returned to the customer at POS checkout. For non-cash payments this is normally zero.';



CREATE TABLE IF NOT EXISTS "public"."pos_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "opened_by" "uuid",
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opening_cash" numeric(12,2) DEFAULT 0 NOT NULL,
    "closed_by" "uuid",
    "closed_at" timestamp with time zone,
    "closing_cash_expected" numeric(12,2),
    "closing_cash_actual" numeric(12,2),
    "closing_cash_difference" numeric(12,2),
    "total_cash_sales" numeric(12,2) DEFAULT 0,
    "total_card_sales" numeric(12,2) DEFAULT 0,
    "total_expenses" numeric(12,2) DEFAULT 0,
    "total_invoices" integer DEFAULT 0,
    "notes" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closing_checks" "jsonb",
    CONSTRAINT "pos_sessions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."pos_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "invoice_id" "uuid",
    "quantity_delta" numeric(12,3) NOT NULL,
    "reason" "text" DEFAULT 'pos_sale'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "idempotency_key" "text"
);


ALTER TABLE "public"."pos_stock_movements" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pos_stock_movements"."idempotency_key" IS 'Optional replay-protection key for browser-initiated manual POS product stock adjustments.';



CREATE TABLE IF NOT EXISTS "public"."product_sku_counters" (
    "tenant_id" "uuid" NOT NULL,
    "prefix" "text" NOT NULL,
    "last_value" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_sku_counters_last_value_check" CHECK (("last_value" >= 0)),
    CONSTRAINT "product_sku_counters_prefix_check" CHECK (("prefix" ~ '^[A-Z0-9]{3}$'::"text"))
);


ALTER TABLE "public"."product_sku_counters" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_sku_counters" IS 'Tenant-scoped counters used to generate readable product and service SKUs.';



CREATE TABLE IF NOT EXISTS "public"."product_stock_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "supplier_id" "uuid",
    "quantity" numeric(12,3) NOT NULL,
    "unit_cost" numeric(12,2) NOT NULL,
    "total_cost" numeric(12,2) NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "note" "text",
    "reference" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_stock_receipts_idempotency_key_length" CHECK ((("length"("idempotency_key") >= 8) AND ("length"("idempotency_key") <= 120))),
    CONSTRAINT "product_stock_receipts_quantity_positive" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "product_stock_receipts_total_cost_nonnegative" CHECK (("total_cost" >= (0)::numeric)),
    CONSTRAINT "product_stock_receipts_unit_cost_nonnegative" CHECK (("unit_cost" >= (0)::numeric))
);


ALTER TABLE "public"."product_stock_receipts" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_stock_receipts" IS 'Audited lightweight product stock receipts for saleable products. Separate from inventory_items purchase receiving.';



COMMENT ON COLUMN "public"."product_stock_receipts"."idempotency_key" IS 'Replay-protection key for one intentional product stock receipt.';



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "description" "text",
    "description_ar" "text",
    "sku" character varying(100),
    "barcode" character varying(100),
    "unit" character varying(50) DEFAULT 'piece'::character varying,
    "unit_ar" character varying(50),
    "price" numeric(12,2) DEFAULT 0 NOT NULL,
    "cost" numeric(12,2) DEFAULT 0,
    "tax_rate" numeric(5,2) DEFAULT 15.00,
    "tax_category" character varying(10) DEFAULT 'S'::character varying,
    "is_taxable" boolean DEFAULT true,
    "stock_quantity" numeric(12,3) DEFAULT 0,
    "min_stock_alert" numeric(12,3) DEFAULT 0,
    "image_url" "text",
    "is_active" boolean DEFAULT true,
    "is_service" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "vat_treatment" character varying(20) DEFAULT 'inherit'::character varying,
    "is_available" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "branch_id" "uuid" NOT NULL,
    "track_stock" boolean DEFAULT false NOT NULL,
    CONSTRAINT "products_vat_treatment_check" CHECK ((("vat_treatment")::"text" = ANY ((ARRAY['inherit'::character varying, 'exclusive'::character varying, 'inclusive'::character varying, 'exempt'::character varying])::"text"[])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "inventory_item_id" "uuid",
    "name" character varying(255) NOT NULL,
    "quantity" numeric(12,3) NOT NULL,
    "unit_cost" numeric(12,2) NOT NULL,
    "total" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "supplier_item_name" "text",
    "line_type" "text" DEFAULT 'stock'::"text" NOT NULL,
    "receiving_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "received_quantity" numeric(12,3) DEFAULT 0 NOT NULL,
    "tax_rate" numeric(5,2),
    "vat_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "match_confidence" numeric(5,2),
    "match_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "ignored_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone
);


ALTER TABLE "public"."purchase_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."purchase_items"."supplier_item_name" IS 'Supplier bill item name, kept separate from the internal stock item name for future AI/OCR and supplier mapping.';



COMMENT ON COLUMN "public"."purchase_items"."line_type" IS 'stock lines may affect inventory after confirmation; non_stock/unmatched/ignored lines remain bill detail only.';



COMMENT ON COLUMN "public"."purchase_items"."match_source" IS 'How an internal item match was selected: manual, ai, mapping, or none. AI matches must still be human-confirmed before receiving.';



CREATE TABLE IF NOT EXISTS "public"."purchase_stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "purchase_item_id" "uuid",
    "inventory_item_id" "uuid" NOT NULL,
    "quantity_delta" numeric(12,3) NOT NULL,
    "unit_cost" numeric(12,2),
    "reason" "text" NOT NULL,
    "reversal_of" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchase_stock_movements_quantity_nonzero" CHECK (("quantity_delta" <> (0)::numeric)),
    CONSTRAINT "purchase_stock_movements_reason_check" CHECK (("reason" = ANY (ARRAY['purchase_receiving_confirmed'::"text", 'purchase_receiving_reversed'::"text"])))
);


ALTER TABLE "public"."purchase_stock_movements" OWNER TO "postgres";


COMMENT ON TABLE "public"."purchase_stock_movements" IS 'Phase 4C stock movement ledger for confirmed and reversed purchase receiving. Browser users read only; writes go through receiving RPCs.';



CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "supplier_id" "uuid",
    "added_by" "uuid",
    "purchase_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "vat_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "payment_method" character varying(20) DEFAULT 'cash'::character varying NOT NULL,
    "bill_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "purchase_mode" "text" DEFAULT 'detailed_receiving'::"text" NOT NULL,
    "status" "text" DEFAULT 'posted'::"text" NOT NULL,
    "bill_number" "text",
    "tax_input_mode" "text" DEFAULT 'none'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "receiving_status" "text" DEFAULT 'not_applicable'::"text" NOT NULL,
    "received_at" timestamp with time zone,
    "received_by" "uuid",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "cancellation_reason" "text",
    "reversed_at" timestamp with time zone,
    "reversed_by" "uuid",
    "reversal_reason" "text",
    "bill_path" "text",
    CONSTRAINT "purchases_payment_method_check" CHECK ((("payment_method")::"text" = ANY ((ARRAY['cash'::character varying, 'card'::character varying, 'bank_transfer'::character varying])::"text"[])))
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


COMMENT ON COLUMN "public"."purchases"."purchase_mode" IS 'simple_bill records supplier bill/accounting history only; detailed_receiving may include purchase_items.';



COMMENT ON COLUMN "public"."purchases"."status" IS 'Purchase document lifecycle groundwork. Existing direct-entry purchases remain posted.';



COMMENT ON COLUMN "public"."purchases"."bill_number" IS 'Supplier bill/invoice number when available.';



COMMENT ON COLUMN "public"."purchases"."tax_input_mode" IS 'How VAT was entered: none, included, excluded, or manual.';



COMMENT ON COLUMN "public"."purchases"."payment_status" IS 'Supplier bill payment status: paid, unpaid, or partial.';



COMMENT ON COLUMN "public"."purchases"."receiving_status" IS 'Stock receiving lifecycle independent of accounting status. New detailed purchases start pending_confirmation and stock changes only through confirm_purchase_receiving.';



COMMENT ON COLUMN "public"."purchases"."bill_path" IS 'Private Storage object path for purchase bill attachments. Existing bill_url is kept for legacy signed URL compatibility.';



CREATE OR REPLACE VIEW "public"."reporting_counted_purchases_v" AS
 SELECT "id",
    "tenant_id",
    "branch_id",
    "supplier_id",
    "purchase_date",
    COALESCE("purchase_mode", 'detailed_receiving'::"text") AS "purchase_mode",
    COALESCE("status", 'posted'::"text") AS "status",
    COALESCE("receiving_status", 'not_applicable'::"text") AS "receiving_status",
    COALESCE("subtotal", (0)::numeric) AS "subtotal",
    COALESCE("vat_amount", (0)::numeric) AS "vat_amount",
    COALESCE("total_amount", (0)::numeric) AS "total_amount",
    ((COALESCE("status", 'posted'::"text") = 'cancelled'::"text") OR (COALESCE("receiving_status", 'not_applicable'::"text") = ANY (ARRAY['cancelled'::"text", 'reversed'::"text"]))) AS "is_deleted_or_reversed",
    ((COALESCE("status", 'posted'::"text") <> 'cancelled'::"text") AND (COALESCE("receiving_status", 'not_applicable'::"text") <> ALL (ARRAY['cancelled'::"text", 'reversed'::"text"])) AND (((COALESCE("purchase_mode", 'detailed_receiving'::"text") = ANY (ARRAY['simple_bill'::"text", 'bill_only'::"text"])) AND (COALESCE("status", 'posted'::"text") = 'posted'::"text")) OR ((COALESCE("purchase_mode", 'detailed_receiving'::"text") = ANY (ARRAY['detailed_receiving'::"text", 'receive_stock'::"text"])) AND (COALESCE("receiving_status", 'not_applicable'::"text") = ANY (ARRAY['confirmed'::"text", 'confirmed_legacy'::"text"]))) OR ((COALESCE("purchase_mode", 'detailed_receiving'::"text") = 'detailed_receiving'::"text") AND (COALESCE("receiving_status", 'not_applicable'::"text") = 'not_applicable'::"text") AND (COALESCE("status", 'posted'::"text") = 'posted'::"text")))) AS "is_counted"
   FROM "public"."purchases" "p";


ALTER VIEW "public"."reporting_counted_purchases_v" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reporting_expenses_v" AS
 SELECT "id",
    "tenant_id",
    "branch_id",
    "category_id",
    "expense_date",
    "description",
    "payment_method",
    "vat_treatment",
    "amount",
    "vat_amount",
    "total_paid",
        CASE
            WHEN ("vat_claim_status" = 'claimable'::"text") THEN "vat_amount"
            ELSE (0)::numeric
        END AS "input_vat_amount",
        CASE
            WHEN ("vat_claim_status" = 'claimable'::"text") THEN GREATEST(COALESCE("raw_expense_before_vat", ("total_paid" - "vat_amount")), (0)::numeric)
            ELSE "total_paid"
        END AS "profit_expense_amount",
    "created_at",
    "vat_claim_status",
        CASE
            WHEN ("vat_claim_status" = 'claimable'::"text") THEN GREATEST(COALESCE("raw_expense_before_vat", ("total_paid" - "vat_amount")), (0)::numeric)
            ELSE COALESCE("raw_expense_before_vat", "total_paid")
        END AS "expense_before_vat",
    "tax_invoice_number",
    "supplier_vat_number",
    "session_id"
   FROM ( SELECT "e"."id",
            "e"."tenant_id",
            "e"."branch_id",
            "e"."category_id",
            "e"."expense_date",
            "e"."description",
            COALESCE("e"."payment_method", 'cash'::character varying) AS "payment_method",
            COALESCE("e"."vat_treatment", 'no_vat'::character varying) AS "vat_treatment",
            COALESCE("e"."amount", (0)::numeric) AS "amount",
            COALESCE("e"."vat_amount", (0)::numeric) AS "vat_amount",
            COALESCE("e"."total_paid", "e"."amount", (0)::numeric) AS "total_paid",
                CASE
                    WHEN ("e"."session_id" IS NOT NULL) THEN 'not_claimable'::"text"
                    WHEN ("e"."vat_claim_status" = ANY (ARRAY['no_vat'::"text", 'claimable'::"text", 'not_claimable'::"text", 'needs_review'::"text"])) THEN "e"."vat_claim_status"
                    WHEN ((COALESCE("e"."vat_amount", (0)::numeric) > (0)::numeric) OR ((COALESCE("e"."vat_treatment", 'no_vat'::character varying))::"text" <> 'no_vat'::"text")) THEN 'needs_review'::"text"
                    ELSE 'no_vat'::"text"
                END AS "vat_claim_status",
            "e"."expense_before_vat" AS "raw_expense_before_vat",
            "e"."tax_invoice_number",
            "e"."supplier_vat_number",
            "e"."session_id",
            "e"."created_at"
           FROM "public"."expenses" "e") "x";


ALTER VIEW "public"."reporting_expenses_v" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reporting_invoice_documents_v" AS
 SELECT "id",
    "tenant_id",
    "branch_id",
    "customer_id",
    "invoice_number",
    "invoice_date",
    "created_at",
    ("zatca_invoice_type")::"text" AS "zatca_invoice_type",
    ("status")::"text" AS "status",
    COALESCE(("payment_method")::"text", 'cash'::"text") AS "payment_method",
    (("status")::"text" = 'posted'::"text") AS "is_counted",
        CASE
            WHEN (("zatca_invoice_type")::"text" = 'credit_note'::"text") THEN '-1'::integer
            ELSE 1
        END AS "accounting_sign",
        CASE
            WHEN ((("status")::"text" = 'posted'::"text") AND (("zatca_invoice_type")::"text" <> 'credit_note'::"text")) THEN COALESCE("total_amount", (0)::numeric)
            ELSE (0)::numeric
        END AS "gross_total_amount",
        CASE
            WHEN ((("status")::"text" = 'posted'::"text") AND (("zatca_invoice_type")::"text" = 'credit_note'::"text")) THEN COALESCE("total_amount", (0)::numeric)
            ELSE (0)::numeric
        END AS "credited_total_amount",
        CASE
            WHEN (("status")::"text" = 'posted'::"text") THEN ((
            CASE
                WHEN (("zatca_invoice_type")::"text" = 'credit_note'::"text") THEN '-1'::integer
                ELSE 1
            END)::numeric * COALESCE("total_amount", (0)::numeric))
            ELSE (0)::numeric
        END AS "signed_total_amount",
        CASE
            WHEN ((("status")::"text" = 'posted'::"text") AND (("zatca_invoice_type")::"text" <> 'credit_note'::"text")) THEN COALESCE("tax_amount", (0)::numeric)
            ELSE (0)::numeric
        END AS "gross_tax_amount",
        CASE
            WHEN ((("status")::"text" = 'posted'::"text") AND (("zatca_invoice_type")::"text" = 'credit_note'::"text")) THEN COALESCE("tax_amount", (0)::numeric)
            ELSE (0)::numeric
        END AS "credited_tax_amount",
        CASE
            WHEN (("status")::"text" = 'posted'::"text") THEN ((
            CASE
                WHEN (("zatca_invoice_type")::"text" = 'credit_note'::"text") THEN '-1'::integer
                ELSE 1
            END)::numeric * COALESCE("tax_amount", (0)::numeric))
            ELSE (0)::numeric
        END AS "signed_tax_amount"
   FROM "public"."invoices" "i";


ALTER VIEW "public"."reporting_invoice_documents_v" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_rate_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "scope_id" "text" NOT NULL,
    "tenant_id" "uuid",
    "branch_id" "uuid",
    "actor_user_id" "uuid",
    "target_type" "text",
    "target_id" "uuid",
    "window_start" timestamp with time zone NOT NULL,
    "window_seconds" integer NOT NULL,
    "max_attempts" integer NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "security_rate_limits_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "security_rate_limits_max_attempts_check" CHECK (("max_attempts" > 0)),
    CONSTRAINT "security_rate_limits_window_seconds_check" CHECK (("window_seconds" > 0))
);


ALTER TABLE "public"."security_rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "public"."security_rate_limits" IS 'DB-backed action counters used by Edge Functions and future safe RPC wrappers.';



CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "name_ar" character varying(100),
    "description" "text",
    "description_ar" "text",
    "price_monthly" numeric(10,2) DEFAULT 0 NOT NULL,
    "price_yearly" numeric(10,2) DEFAULT 0 NOT NULL,
    "max_branches" integer DEFAULT 1 NOT NULL,
    "max_users" integer DEFAULT 5 NOT NULL,
    "max_products" integer DEFAULT 100 NOT NULL,
    "features" "jsonb" DEFAULT '[]'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_item_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "supplier_id" "uuid",
    "supplier_item_name" "text" NOT NULL,
    "normalized_name" "text" NOT NULL,
    "matched_inventory_item_id" "uuid",
    "matched_product_id" "uuid",
    "match_confidence" numeric(5,2),
    "confirmation_status" "text" DEFAULT 'manual_confirmed'::"text" NOT NULL,
    "confirmed_by" "uuid",
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "normalized_supplier_item_name" "text" NOT NULL,
    "confidence" numeric(5,2),
    "match_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "confirmed_at" timestamp with time zone,
    CONSTRAINT "supplier_item_mappings_confirmation_status_check" CHECK (("confirmation_status" = ANY (ARRAY['ai_suggested'::"text", 'manual_confirmed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."supplier_item_mappings" OWNER TO "postgres";


COMMENT ON TABLE "public"."supplier_item_mappings" IS 'Supplier bill item name mappings used only to suggest internal inventory/product matches. Mappings never update stock directly.';



COMMENT ON COLUMN "public"."supplier_item_mappings"."branch_id" IS 'Nullable for future tenant-wide/product mappings; inventory-item mappings are normally branch-specific.';



COMMENT ON COLUMN "public"."supplier_item_mappings"."match_source" IS 'Mapping origin: manual, ai, or imported. Manual matches should be preferred over future AI suggestions.';



CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "vat_number" character varying(20),
    "cr_number" character varying(20),
    "contact_person" character varying(255),
    "phone" character varying(50),
    "email" character varying(255),
    "city" character varying(100),
    "address" "text",
    "payment_terms" character varying(20) DEFAULT 'cash'::character varying NOT NULL,
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "branch_id" "uuid" NOT NULL,
    CONSTRAINT "suppliers_payment_terms_check" CHECK ((("payment_terms")::"text" = ANY ((ARRAY['cash'::character varying, 'credit_30'::character varying, 'credit_60'::character varying])::"text"[])))
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_queue" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "invoice_id" "uuid",
    "action" character varying(50) NOT NULL,
    "payload" "jsonb",
    "status" "public"."sync_status" DEFAULT 'pending'::"public"."sync_status",
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "last_attempt_at" timestamp with time zone,
    "last_error" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sync_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_onboarding_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "onboarding_status" "text" DEFAULT 'details_pending'::"text" NOT NULL,
    "owner_setup_status" "text" DEFAULT 'owner_invited'::"text" NOT NULL,
    "branch_setup_status" "text" DEFAULT 'branch_setup_pending'::"text" NOT NULL,
    "zatca_setup_status" "text" DEFAULT 'zatca_setup_pending'::"text" NOT NULL,
    "ready_for_billing" boolean DEFAULT false NOT NULL,
    "owner_setup_link_sent_at" timestamp with time zone,
    "owner_setup_completed_at" timestamp with time zone,
    "first_branch_created_at" timestamp with time zone,
    "first_invoice_created_at" timestamp with time zone,
    "notes" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenant_onboarding_branch_setup_status_check" CHECK (("branch_setup_status" = ANY (ARRAY['branch_setup_pending'::"text", 'first_branch_created'::"text", 'branch_setup_complete'::"text"]))),
    CONSTRAINT "tenant_onboarding_owner_setup_status_check" CHECK (("owner_setup_status" = ANY (ARRAY['owner_invited'::"text", 'owner_setup_complete'::"text", 'setup_link_expired'::"text", 'setup_blocked'::"text"]))),
    CONSTRAINT "tenant_onboarding_status_check" CHECK (("onboarding_status" = ANY (ARRAY['details_pending'::"text", 'owner_invited'::"text", 'owner_setup_complete'::"text", 'branch_setup_pending'::"text", 'zatca_setup_pending'::"text", 'ready_for_billing'::"text", 'live'::"text"]))),
    CONSTRAINT "tenant_onboarding_zatca_setup_status_check" CHECK (("zatca_setup_status" = ANY (ARRAY['zatca_setup_pending'::"text", 'not_required'::"text", 'in_progress'::"text", 'production_ready'::"text", 'needs_attention'::"text"])))
);


ALTER TABLE "public"."tenant_onboarding_status" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_onboarding_status" IS 'Manual onboarding checklist/status foundation for Kubri super-admin operations.';



CREATE TABLE IF NOT EXISTS "public"."tenant_subscriptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "status" "public"."subscription_status" DEFAULT 'trial'::"public"."subscription_status",
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "moyasar_subscription_id" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "plan_interval" "text" DEFAULT 'manual'::"text" NOT NULL,
    "price_per_branch" numeric(12,2),
    "paid_branch_count" integer DEFAULT 1 NOT NULL,
    "current_period_start" "date",
    "current_period_end" "date",
    "next_due_date" "date",
    "grace_until_date" "date",
    "manual_payment_status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "subscription_lifecycle_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "last_payment_id" "uuid",
    "last_payment_at" timestamp with time zone,
    "suspended_at" timestamp with time zone,
    "suspended_reason" "text",
    "updated_by" "uuid",
    CONSTRAINT "tenant_subscriptions_due_grace_check" CHECK ((("next_due_date" IS NULL) OR ("grace_until_date" IS NULL) OR ("grace_until_date" >= "next_due_date"))),
    CONSTRAINT "tenant_subscriptions_lifecycle_status_check" CHECK (("subscription_lifecycle_status" = ANY (ARRAY['setup_pending'::"text", 'active'::"text", 'payment_due'::"text", 'grace_period'::"text", 'suspended'::"text", 'cancelled'::"text", 'lifetime_free'::"text"]))),
    CONSTRAINT "tenant_subscriptions_manual_payment_status_check" CHECK (("manual_payment_status" = ANY (ARRAY['unpaid'::"text", 'manual_verified'::"text", 'overdue'::"text", 'refunded'::"text"]))),
    CONSTRAINT "tenant_subscriptions_paid_branch_count_check" CHECK (("paid_branch_count" >= 1)),
    CONSTRAINT "tenant_subscriptions_period_dates_check" CHECK ((("current_period_start" IS NULL) OR ("current_period_end" IS NULL) OR ("current_period_end" >= "current_period_start"))),
    CONSTRAINT "tenant_subscriptions_plan_interval_check" CHECK (("plan_interval" = ANY (ARRAY['monthly'::"text", 'yearly'::"text", 'manual'::"text", 'custom'::"text", 'lifetime'::"text"]))),
    CONSTRAINT "tenant_subscriptions_price_per_branch_check" CHECK ((("price_per_branch" IS NULL) OR ("price_per_branch" >= (0)::numeric)))
);


ALTER TABLE "public"."tenant_subscriptions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenant_subscriptions"."plan_interval" IS 'Manual billing interval for Kubri subscription operations: monthly, yearly, manual, custom, or lifetime.';



COMMENT ON COLUMN "public"."tenant_subscriptions"."manual_payment_status" IS 'Manual payment status for offline payments before gateway integration.';



COMMENT ON COLUMN "public"."tenant_subscriptions"."subscription_lifecycle_status" IS 'Non-destructive manual lifecycle status used by Kubri support; does not replace the legacy subscription_status enum.';



CREATE TABLE IF NOT EXISTS "public"."tenant_support_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "note" "text" NOT NULL,
    "note_type" "text" DEFAULT 'general'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenant_support_notes_note_no_empty" CHECK (("length"("btrim"("note")) > 0)),
    CONSTRAINT "tenant_support_notes_note_type_check" CHECK (("note_type" = ANY (ARRAY['general'::"text", 'payment'::"text", 'onboarding'::"text", 'support'::"text", 'risk'::"text", 'zatca'::"text"])))
);


ALTER TABLE "public"."tenant_support_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_support_notes" IS 'Internal Kubri support notes; replaces misuse of tenants.address for support/payment/onboarding notes.';



CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "name_ar" character varying(255),
    "vat_number" character varying(15) NOT NULL,
    "cr_number" character varying(20),
    "email" character varying(255),
    "phone" character varying(20),
    "address" "text",
    "address_ar" "text",
    "building_number" character varying(10),
    "additional_number" character varying(10),
    "street" character varying(255),
    "street_ar" character varying(255),
    "district" character varying(100),
    "district_ar" character varying(100),
    "city" character varying(100),
    "city_ar" character varying(100),
    "country" character(2) DEFAULT 'SA'::"bpchar",
    "postal_code" character varying(10),
    "logo_url" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "suspended_at" timestamp with time zone,
    "suspended_reason" "text",
    "last_active_at" timestamp with time zone,
    "max_branches" integer DEFAULT 999,
    "business_type" "text" DEFAULT 'trading'::"text"
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenants"."business_type" IS 'Launch reporting/UX mode for tenant: trading or service. NULL is treated as trading for backward compatibility.';



CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "tenant_id" "uuid",
    "branch_id" "uuid",
    "role" "public"."user_role" DEFAULT 'branch'::"public"."user_role" NOT NULL,
    "full_name" character varying(255),
    "full_name_ar" character varying(255),
    "phone" character varying(20),
    "avatar_url" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email" "text"
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profiles"."email" IS 'Mirror of the Supabase Auth email used by service-role account management flows; nullable for legacy rows.';



CREATE TABLE IF NOT EXISTS "public"."zatca_certificates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "csr" "text",
    "certificate" "text",
    "private_key_encrypted" "text",
    "otp" character varying(6),
    "compliance_request_id" character varying(255),
    "compliance_csid" character varying(512),
    "production_request_id" character varying(255),
    "production_csid" character varying(512),
    "status" "public"."certificate_status" DEFAULT 'pending'::"public"."certificate_status",
    "environment" character varying(20) DEFAULT 'sandbox'::character varying,
    "serial_number" character varying(255),
    "valid_from" timestamp with time zone,
    "valid_to" timestamp with time zone,
    "last_invoice_hash" "text",
    "invoice_counter" bigint DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "compliance_secret" "text",
    "production_secret" "text",
    "public_key_pem" "text",
    "activated_at" timestamp with time zone
);


ALTER TABLE "public"."zatca_certificates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zatca_production_credentials" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "environment" "text" DEFAULT 'production'::"text" NOT NULL,
    "egs_serial_number" "text" NOT NULL,
    "csr_common_name" "text",
    "csr_organization_name" "text",
    "csr_organizational_unit_name" "text",
    "csr_location" "text",
    "csr_industry" "text",
    "csr_pem" "text",
    "public_key_pem" "text",
    "encrypted_private_key" "text",
    "compliance_request_id" "text",
    "encrypted_compliance_csid" "text",
    "encrypted_compliance_secret" "text",
    "encrypted_production_csid" "text",
    "encrypted_production_secret" "text",
    "onboarding_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "functionality_map" "text" NOT NULL,
    "certificate_valid_from" timestamp with time zone,
    "certificate_valid_to" timestamp with time zone,
    "compliance_sample_results" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "last_error" "text",
    "connected_at" timestamp with time zone,
    "disconnected_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "zatca_production_credentials_environment_check" CHECK (("environment" = 'production'::"text")),
    CONSTRAINT "zatca_production_credentials_functionality_map_check" CHECK (("functionality_map" = ANY (ARRAY['0100'::"text", '1000'::"text", '1100'::"text"]))),
    CONSTRAINT "zatca_production_credentials_onboarding_status_check" CHECK (("onboarding_status" = ANY (ARRAY['not_started'::"text", 'generating_csr'::"text", 'compliance_csid_requested'::"text", 'compliance_samples_passed'::"text", 'production_csid_requested'::"text", 'production_connected'::"text", 'disconnected'::"text", 'compliance_failed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."zatca_production_credentials" OWNER TO "postgres";


COMMENT ON TABLE "public"."zatca_production_credentials" IS 'Backend-only encrypted ZATCA production onboarding credentials. No direct frontend RLS policies.';



COMMENT ON COLUMN "public"."zatca_production_credentials"."encrypted_private_key" IS 'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';



COMMENT ON COLUMN "public"."zatca_production_credentials"."encrypted_compliance_csid" IS 'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';



COMMENT ON COLUMN "public"."zatca_production_credentials"."encrypted_compliance_secret" IS 'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';



COMMENT ON COLUMN "public"."zatca_production_credentials"."encrypted_production_csid" IS 'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';



COMMENT ON COLUMN "public"."zatca_production_credentials"."encrypted_production_secret" IS 'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';



COMMENT ON COLUMN "public"."zatca_production_credentials"."disconnected_at" IS 'Timestamp when Dafra local production submission was soft-disabled for this branch. This does not revoke the FATOORA device.';



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_login_usernames"
    ADD CONSTRAINT "branch_login_usernames_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_tenant_id_branch_code_key" UNIQUE ("tenant_id", "branch_code");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."day_closings"
    ADD CONSTRAINT "day_closings_branch_id_closing_date_key" UNIQUE ("branch_id", "closing_date");



ALTER TABLE ONLY "public"."day_closings"
    ADD CONSTRAINT "day_closings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."expenses"
    ADD CONSTRAINT "expenses_expense_before_vat_check" CHECK ((("expense_before_vat" IS NULL) OR ("expense_before_vat" >= (0)::numeric))) NOT VALID;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."expenses"
    ADD CONSTRAINT "expenses_vat_claim_status_check" CHECK ((("vat_claim_status" IS NULL) OR ("vat_claim_status" = ANY (ARRAY['no_vat'::"text", 'claimable'::"text", 'not_claimable'::"text", 'needs_review'::"text"])))) NOT VALID;



ALTER TABLE ONLY "public"."fixed_expenses"
    ADD CONSTRAINT "fixed_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_quantity_positive" CHECK (("quantity" > (0)::numeric)) NOT VALID;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_branch_id_invoice_number_key" UNIQUE ("branch_id", "invoice_number");



ALTER TABLE "public"."invoices"
    ADD CONSTRAINT "invoices_credit_note_reason_required" CHECK ((("zatca_invoice_type" <> 'credit_note'::"public"."invoice_type") OR (NULLIF(TRIM(BOTH FROM COALESCE("credit_reason", ''::"text")), ''::"text") IS NOT NULL))) NOT VALID;



ALTER TABLE "public"."invoices"
    ADD CONSTRAINT "invoices_credit_note_type_code" CHECK ((("zatca_invoice_type" <> 'credit_note'::"public"."invoice_type") OR (("zatca_type_code")::"text" = '381'::"text"))) NOT VALID;



ALTER TABLE "public"."invoices"
    ADD CONSTRAINT "invoices_original_invoice_not_self" CHECK ((("original_invoice_id" IS NULL) OR ("original_invoice_id" <> "id"))) NOT VALID;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_zatca_uuid_key" UNIQUE ("zatca_uuid");



ALTER TABLE ONLY "public"."manual_subscription_payments"
    ADD CONSTRAINT "manual_subscription_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."payments"
    ADD CONSTRAINT "payments_amount_positive" CHECK (("amount" > (0)::numeric)) NOT VALID;



ALTER TABLE "public"."payments"
    ADD CONSTRAINT "payments_amount_received_nonnegative" CHECK ((("amount_received" IS NULL) OR ("amount_received" >= (0)::numeric))) NOT VALID;



ALTER TABLE "public"."payments"
    ADD CONSTRAINT "payments_change_amount_nonnegative" CHECK ((("change_amount" IS NULL) OR ("change_amount" >= (0)::numeric))) NOT VALID;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_sessions"
    ADD CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_stock_movements"
    ADD CONSTRAINT "pos_stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_sku_counters"
    ADD CONSTRAINT "product_sku_counters_pkey" PRIMARY KEY ("tenant_id", "prefix");



ALTER TABLE ONLY "public"."product_stock_receipts"
    ADD CONSTRAINT "product_stock_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_tenant_id_sku_key" UNIQUE ("tenant_id", "sku");



ALTER TABLE "public"."products"
    ADD CONSTRAINT "products_tracked_stock_nonnegative" CHECK ((("track_stock" = false) OR ("stock_quantity" >= (0)::numeric))) NOT VALID;



ALTER TABLE "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_line_type_check" CHECK (("line_type" = ANY (ARRAY['stock'::"text", 'non_stock'::"text", 'unmatched'::"text", 'ignored'::"text"]))) NOT VALID;



ALTER TABLE "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_match_source_check" CHECK (("match_source" = ANY (ARRAY['manual'::"text", 'ai'::"text", 'mapping'::"text", 'none'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_receiving_status_check" CHECK (("receiving_status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'skipped'::"text", 'cancelled'::"text", 'reversed'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."purchases"
    ADD CONSTRAINT "purchases_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['paid'::"text", 'unpaid'::"text", 'partial'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."purchases"
    ADD CONSTRAINT "purchases_purchase_mode_check" CHECK (("purchase_mode" = ANY (ARRAY['simple_bill'::"text", 'detailed_receiving'::"text"]))) NOT VALID;



ALTER TABLE "public"."purchases"
    ADD CONSTRAINT "purchases_receiving_status_check" CHECK (("receiving_status" = ANY (ARRAY['not_applicable'::"text", 'draft'::"text", 'pending_confirmation'::"text", 'confirmed'::"text", 'cancelled'::"text", 'reversed'::"text", 'confirmed_legacy'::"text"]))) NOT VALID;



ALTER TABLE "public"."purchases"
    ADD CONSTRAINT "purchases_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'cancelled'::"text"]))) NOT VALID;



ALTER TABLE "public"."purchases"
    ADD CONSTRAINT "purchases_tax_input_mode_check" CHECK (("tax_input_mode" = ANY (ARRAY['none'::"text", 'included'::"text", 'excluded'::"text", 'manual'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."security_rate_limits"
    ADD CONSTRAINT "security_rate_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_rate_limits"
    ADD CONSTRAINT "security_rate_limits_unique_window" UNIQUE ("action", "scope", "scope_id", "window_start", "window_seconds");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_match_source_check" CHECK (("match_source" = ANY (ARRAY['manual'::"text", 'ai'::"text", 'imported'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_queue"
    ADD CONSTRAINT "sync_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_onboarding_status"
    ADD CONSTRAINT "tenant_onboarding_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_onboarding_status"
    ADD CONSTRAINT "tenant_onboarding_status_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_support_notes"
    ADD CONSTRAINT "tenant_support_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."tenants"
    ADD CONSTRAINT "tenants_business_type_check" CHECK ((("business_type" IS NULL) OR ("business_type" = ANY (ARRAY['trading'::"text", 'service'::"text"])))) NOT VALID;



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_vat_number_key" UNIQUE ("vat_number");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zatca_certificates"
    ADD CONSTRAINT "zatca_certificates_branch_id_environment_key" UNIQUE ("branch_id", "environment");



ALTER TABLE ONLY "public"."zatca_certificates"
    ADD CONSTRAINT "zatca_certificates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zatca_production_credentials"
    ADD CONSTRAINT "zatca_production_credentials_branch_id_environment_key" UNIQUE ("branch_id", "environment");



ALTER TABLE ONLY "public"."zatca_production_credentials"
    ADD CONSTRAINT "zatca_production_credentials_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_events_action_created_idx" ON "public"."audit_events" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "audit_events_actor_created_idx" ON "public"."audit_events" USING "btree" ("actor_user_id", "created_at" DESC) WHERE ("actor_user_id" IS NOT NULL);



CREATE INDEX "audit_events_branch_created_idx" ON "public"."audit_events" USING "btree" ("branch_id", "created_at" DESC) WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "audit_events_tenant_created_idx" ON "public"."audit_events" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "branch_login_usernames_active_lookup_idx" ON "public"."branch_login_usernames" USING "btree" ("normalized_username") WHERE ("is_active" IS TRUE);



CREATE UNIQUE INDEX "branch_login_usernames_internal_auth_email_uidx" ON "public"."branch_login_usernames" USING "btree" ("lower"("internal_auth_email"));



CREATE UNIQUE INDEX "branch_login_usernames_normalized_username_uidx" ON "public"."branch_login_usernames" USING "btree" ("normalized_username");



CREATE INDEX "branch_login_usernames_tenant_branch_idx" ON "public"."branch_login_usernames" USING "btree" ("tenant_id", "branch_id");



CREATE UNIQUE INDEX "branch_login_usernames_user_id_uidx" ON "public"."branch_login_usernames" USING "btree" ("user_id");



CREATE UNIQUE INDEX "expense_categories_system_name_uq" ON "public"."expense_categories" USING "btree" ("name") WHERE ("tenant_id" IS NULL);



CREATE INDEX "expenses_branch_date_idx" ON "public"."expenses" USING "btree" ("branch_id", "expense_date" DESC);



CREATE INDEX "expenses_session_id_idx" ON "public"."expenses" USING "btree" ("session_id");



CREATE INDEX "expenses_supplier_id_idx" ON "public"."expenses" USING "btree" ("supplier_id") WHERE ("supplier_id" IS NOT NULL);



CREATE INDEX "expenses_tenant_idx" ON "public"."expenses" USING "btree" ("tenant_id", "expense_date" DESC);



CREATE INDEX "expenses_vat_claim_status_idx" ON "public"."expenses" USING "btree" ("branch_id", "vat_claim_status", "expense_date" DESC);



CREATE INDEX "idx_branches_tenant" ON "public"."branches" USING "btree" ("tenant_id");



CREATE INDEX "idx_categories_branch" ON "public"."categories" USING "btree" ("branch_id");



CREATE INDEX "idx_categories_parent" ON "public"."categories" USING "btree" ("parent_id");



CREATE INDEX "idx_categories_tenant" ON "public"."categories" USING "btree" ("tenant_id");



CREATE INDEX "idx_customers_branch" ON "public"."customers" USING "btree" ("branch_id");



CREATE INDEX "idx_customers_tenant" ON "public"."customers" USING "btree" ("tenant_id");



CREATE INDEX "idx_customers_vat" ON "public"."customers" USING "btree" ("vat_number") WHERE ("vat_number" IS NOT NULL);



CREATE INDEX "idx_day_closings_branch" ON "public"."day_closings" USING "btree" ("branch_id");



CREATE INDEX "idx_day_closings_date" ON "public"."day_closings" USING "btree" ("closing_date" DESC);



CREATE INDEX "idx_day_closings_tenant" ON "public"."day_closings" USING "btree" ("tenant_id");



CREATE INDEX "idx_employees_active" ON "public"."employees" USING "btree" ("tenant_id", "is_active");



CREATE INDEX "idx_employees_branch" ON "public"."employees" USING "btree" ("branch_id");



CREATE INDEX "idx_employees_tenant" ON "public"."employees" USING "btree" ("tenant_id");



CREATE INDEX "idx_invoice_items_invoice" ON "public"."invoice_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_items_product" ON "public"."invoice_items" USING "btree" ("product_id");



CREATE INDEX "idx_invoice_items_tenant" ON "public"."invoice_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_invoices_branch" ON "public"."invoices" USING "btree" ("branch_id");



CREATE INDEX "idx_invoices_created_by" ON "public"."invoices" USING "btree" ("created_by");



CREATE INDEX "idx_invoices_customer" ON "public"."invoices" USING "btree" ("customer_id");



CREATE INDEX "idx_invoices_date" ON "public"."invoices" USING "btree" ("invoice_date");



CREATE INDEX "idx_invoices_number" ON "public"."invoices" USING "btree" ("branch_id", "invoice_number");



CREATE INDEX "idx_invoices_status" ON "public"."invoices" USING "btree" ("status");



CREATE INDEX "idx_invoices_tenant" ON "public"."invoices" USING "btree" ("tenant_id");



CREATE INDEX "idx_invoices_zatca_status" ON "public"."invoices" USING "btree" ("zatca_status");



CREATE INDEX "idx_invoices_zatca_uuid" ON "public"."invoices" USING "btree" ("zatca_uuid");



CREATE INDEX "idx_payments_invoice" ON "public"."payments" USING "btree" ("invoice_id");



CREATE INDEX "idx_payments_tenant" ON "public"."payments" USING "btree" ("tenant_id");



CREATE INDEX "idx_products_barcode" ON "public"."products" USING "btree" ("barcode");



CREATE INDEX "idx_products_branch" ON "public"."products" USING "btree" ("branch_id");



CREATE INDEX "idx_products_category" ON "public"."products" USING "btree" ("category_id");



CREATE INDEX "idx_products_tenant" ON "public"."products" USING "btree" ("tenant_id");



CREATE INDEX "idx_suppliers_branch" ON "public"."suppliers" USING "btree" ("branch_id");



CREATE INDEX "idx_sync_queue_action" ON "public"."sync_queue" USING "btree" ("action");



CREATE INDEX "idx_sync_queue_invoice" ON "public"."sync_queue" USING "btree" ("invoice_id");



CREATE INDEX "idx_sync_queue_status" ON "public"."sync_queue" USING "btree" ("status");



CREATE INDEX "idx_sync_queue_tenant" ON "public"."sync_queue" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenant_subs_status" ON "public"."tenant_subscriptions" USING "btree" ("status");



CREATE INDEX "idx_tenant_subs_tenant" ON "public"."tenant_subscriptions" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenants_vat" ON "public"."tenants" USING "btree" ("vat_number");



CREATE INDEX "idx_user_profiles_branch" ON "public"."user_profiles" USING "btree" ("branch_id");



CREATE INDEX "idx_user_profiles_role" ON "public"."user_profiles" USING "btree" ("role");



CREATE INDEX "idx_user_profiles_tenant" ON "public"."user_profiles" USING "btree" ("tenant_id");



CREATE INDEX "idx_zatca_certs_branch" ON "public"."zatca_certificates" USING "btree" ("branch_id");



CREATE INDEX "idx_zatca_certs_tenant" ON "public"."zatca_certificates" USING "btree" ("tenant_id");



CREATE INDEX "idx_zatca_prod_credentials_branch" ON "public"."zatca_production_credentials" USING "btree" ("branch_id");



CREATE INDEX "idx_zatca_prod_credentials_tenant" ON "public"."zatca_production_credentials" USING "btree" ("tenant_id");



CREATE INDEX "inventory_items_branch_idx" ON "public"."inventory_items" USING "btree" ("branch_id");



CREATE INDEX "inventory_items_tenant_idx" ON "public"."inventory_items" USING "btree" ("tenant_id");



CREATE INDEX "invoice_items_original_invoice_item_idx" ON "public"."invoice_items" USING "btree" ("original_invoice_item_id") WHERE ("original_invoice_item_id" IS NOT NULL);



CREATE UNIQUE INDEX "invoices_branch_checkout_idempotency_key_idx" ON "public"."invoices" USING "btree" ("branch_id", "checkout_idempotency_key") WHERE ("checkout_idempotency_key" IS NOT NULL);



CREATE UNIQUE INDEX "invoices_branch_credit_note_idempotency_key_idx" ON "public"."invoices" USING "btree" ("branch_id", "credit_note_idempotency_key") WHERE ("credit_note_idempotency_key" IS NOT NULL);



CREATE INDEX "invoices_branch_date_created_idx" ON "public"."invoices" USING "btree" ("tenant_id", "branch_id", "invoice_date" DESC, "created_at" DESC);



COMMENT ON INDEX "public"."invoices_branch_date_created_idx" IS 'Supports invoice list filtering by tenant, branch, invoice_date range, newest first.';



CREATE INDEX "invoices_branch_zatca_status_created_idx" ON "public"."invoices" USING "btree" ("tenant_id", "branch_id", "zatca_status", "created_at" DESC);



COMMENT ON INDEX "public"."invoices_branch_zatca_status_created_idx" IS 'Supports branch invoice list and retry/status scans by ZATCA status.';



CREATE INDEX "invoices_credit_notes_by_original_idx" ON "public"."invoices" USING "btree" ("tenant_id", "branch_id", "original_invoice_id", "created_at" DESC) WHERE (("original_invoice_id" IS NOT NULL) AND ("zatca_invoice_type" = 'credit_note'::"public"."invoice_type") AND ("status" <> 'cancelled'::"public"."invoice_status"));



COMMENT ON INDEX "public"."invoices_credit_notes_by_original_idx" IS 'Supports invoice list lookup of linked full credit notes for displayed original invoices.';



CREATE INDEX "invoices_original_credit_notes_active_idx" ON "public"."invoices" USING "btree" ("original_invoice_id", "created_at" DESC) WHERE (("original_invoice_id" IS NOT NULL) AND ("zatca_invoice_type" = 'credit_note'::"public"."invoice_type") AND ("status" <> 'cancelled'::"public"."invoice_status"));



CREATE INDEX "invoices_original_invoice_idx" ON "public"."invoices" USING "btree" ("original_invoice_id", "created_at" DESC) WHERE ("original_invoice_id" IS NOT NULL);



CREATE INDEX "invoices_session_id_idx" ON "public"."invoices" USING "btree" ("session_id");



CREATE INDEX "manual_subscription_payments_next_due_idx" ON "public"."manual_subscription_payments" USING "btree" ("next_due_date", "status");



CREATE INDEX "manual_subscription_payments_subscription_idx" ON "public"."manual_subscription_payments" USING "btree" ("subscription_id") WHERE ("subscription_id" IS NOT NULL);



CREATE INDEX "manual_subscription_payments_tenant_received_idx" ON "public"."manual_subscription_payments" USING "btree" ("tenant_id", "payment_received_at" DESC);



CREATE INDEX "payment_refunds_branch_created_idx" ON "public"."payment_refunds" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "payment_refunds_credit_note_invoice_idx" ON "public"."payment_refunds" USING "btree" ("credit_note_invoice_id");



CREATE INDEX "payment_refunds_original_invoice_idx" ON "public"."payment_refunds" USING "btree" ("original_invoice_id", "created_at" DESC);



CREATE INDEX "pos_sessions_branch_id_idx" ON "public"."pos_sessions" USING "btree" ("branch_id");



CREATE INDEX "pos_sessions_branch_status_idx" ON "public"."pos_sessions" USING "btree" ("branch_id", "status");



CREATE UNIQUE INDEX "pos_sessions_one_open_per_branch_idx" ON "public"."pos_sessions" USING "btree" ("branch_id") WHERE ("status" = 'open'::"text");



CREATE INDEX "pos_stock_movements_branch_created_idx" ON "public"."pos_stock_movements" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "pos_stock_movements_invoice_idx" ON "public"."pos_stock_movements" USING "btree" ("invoice_id");



CREATE UNIQUE INDEX "pos_stock_movements_product_idempotency_key_idx" ON "public"."pos_stock_movements" USING "btree" ("tenant_id", "branch_id", "product_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "product_stock_receipts_branch_created_idx" ON "public"."product_stock_receipts" USING "btree" ("tenant_id", "branch_id", "created_at" DESC);



CREATE INDEX "product_stock_receipts_product_created_idx" ON "public"."product_stock_receipts" USING "btree" ("product_id", "created_at" DESC);



CREATE UNIQUE INDEX "product_stock_receipts_product_idempotency_key_idx" ON "public"."product_stock_receipts" USING "btree" ("tenant_id", "branch_id", "product_id", "idempotency_key");



CREATE INDEX "product_stock_receipts_supplier_created_idx" ON "public"."product_stock_receipts" USING "btree" ("supplier_id", "created_at" DESC) WHERE ("supplier_id" IS NOT NULL);



CREATE UNIQUE INDEX "products_tenant_normalized_sku_uidx" ON "public"."products" USING "btree" ("tenant_id", "lower"("btrim"(("sku")::"text"))) WHERE (("sku" IS NOT NULL) AND ("btrim"(("sku")::"text") <> ''::"text"));



COMMENT ON INDEX "public"."products_tenant_normalized_sku_uidx" IS 'Enforces tenant-level case-insensitive product/service SKU uniqueness, including archived products.';



CREATE INDEX "purchase_items_inventory_receiving_idx" ON "public"."purchase_items" USING "btree" ("inventory_item_id", "receiving_status") WHERE ("inventory_item_id" IS NOT NULL);



CREATE INDEX "purchase_items_purchase_idx" ON "public"."purchase_items" USING "btree" ("purchase_id");



CREATE INDEX "purchase_items_receiving_status_idx" ON "public"."purchase_items" USING "btree" ("purchase_id", "receiving_status");



CREATE INDEX "purchase_stock_movements_branch_idx" ON "public"."purchase_stock_movements" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "purchase_stock_movements_inventory_idx" ON "public"."purchase_stock_movements" USING "btree" ("inventory_item_id", "created_at" DESC);



CREATE INDEX "purchase_stock_movements_purchase_idx" ON "public"."purchase_stock_movements" USING "btree" ("purchase_id", "created_at" DESC);



CREATE INDEX "purchases_bill_path_idx" ON "public"."purchases" USING "btree" ("branch_id", "created_at" DESC) WHERE ("bill_path" IS NOT NULL);



CREATE INDEX "purchases_branch_date_idx" ON "public"."purchases" USING "btree" ("branch_id", "purchase_date" DESC);



CREATE INDEX "purchases_branch_mode_date_idx" ON "public"."purchases" USING "btree" ("branch_id", "purchase_mode", "purchase_date" DESC);



CREATE INDEX "purchases_branch_receiving_status_idx" ON "public"."purchases" USING "btree" ("branch_id", "receiving_status", "purchase_date" DESC);



CREATE INDEX "purchases_branch_status_date_idx" ON "public"."purchases" USING "btree" ("branch_id", "status", "purchase_date" DESC);



CREATE INDEX "purchases_tenant_date_idx" ON "public"."purchases" USING "btree" ("tenant_id", "purchase_date" DESC);



CREATE INDEX "security_rate_limits_actor_window_idx" ON "public"."security_rate_limits" USING "btree" ("actor_user_id", "action", "window_start" DESC) WHERE ("actor_user_id" IS NOT NULL);



CREATE INDEX "security_rate_limits_branch_window_idx" ON "public"."security_rate_limits" USING "btree" ("branch_id", "action", "window_start" DESC) WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "security_rate_limits_tenant_window_idx" ON "public"."security_rate_limits" USING "btree" ("tenant_id", "action", "window_start" DESC) WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "supplier_item_mappings_branch_idx" ON "public"."supplier_item_mappings" USING "btree" ("branch_id", "last_used_at" DESC NULLS LAST);



CREATE INDEX "supplier_item_mappings_inventory_idx" ON "public"."supplier_item_mappings" USING "btree" ("matched_inventory_item_id") WHERE (("matched_inventory_item_id" IS NOT NULL) AND ("is_active" IS TRUE));



CREATE INDEX "supplier_item_mappings_lookup_idx" ON "public"."supplier_item_mappings" USING "btree" ("tenant_id", "supplier_id", "normalized_supplier_item_name", "branch_id", "is_active");



CREATE UNIQUE INDEX "supplier_item_mappings_supplier_name_idx" ON "public"."supplier_item_mappings" USING "btree" ("tenant_id", "branch_id", "supplier_id", "normalized_name") WHERE ("supplier_id" IS NOT NULL);



CREATE INDEX "suppliers_tenant_idx" ON "public"."suppliers" USING "btree" ("tenant_id");



CREATE INDEX "tenant_onboarding_status_status_idx" ON "public"."tenant_onboarding_status" USING "btree" ("onboarding_status", "ready_for_billing");



CREATE INDEX "tenant_subscriptions_lifecycle_idx" ON "public"."tenant_subscriptions" USING "btree" ("subscription_lifecycle_status", "next_due_date");



CREATE INDEX "tenant_subscriptions_next_due_idx" ON "public"."tenant_subscriptions" USING "btree" ("next_due_date") WHERE ("next_due_date" IS NOT NULL);



CREATE INDEX "tenant_subscriptions_payment_status_idx" ON "public"."tenant_subscriptions" USING "btree" ("manual_payment_status", "next_due_date");



CREATE INDEX "tenant_support_notes_tenant_created_idx" ON "public"."tenant_support_notes" USING "btree" ("tenant_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "phase3c_audit_branch_write" AFTER INSERT OR DELETE OR UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."audit_branch_write_event"();



CREATE OR REPLACE TRIGGER "phase3c_audit_invoice_insert" AFTER INSERT ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."audit_invoice_insert_event"();



CREATE OR REPLACE TRIGGER "phase3c_audit_user_profile_write" AFTER INSERT OR UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_user_profile_write_event"();



CREATE OR REPLACE TRIGGER "phase4b_audit_purchase_write" AFTER INSERT OR UPDATE ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."audit_purchase_write_event"();



CREATE OR REPLACE TRIGGER "trg_branch_login_usernames_updated_at" BEFORE UPDATE ON "public"."branch_login_usernames" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_branch_login_usernames_validate_scope" BEFORE INSERT OR UPDATE ON "public"."branch_login_usernames" FOR EACH ROW EXECUTE FUNCTION "public"."validate_branch_login_username_scope"();



CREATE OR REPLACE TRIGGER "trg_branches_phase4e_enforce_creation" BEFORE INSERT OR UPDATE OF "is_active", "tenant_id" ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_branch_creation_limit_and_suspension"();



CREATE OR REPLACE TRIGGER "trg_branches_updated_at" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_categories_updated_at" BEFORE UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_customers_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_employees_updated_at" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."update_employees_updated_at"();



CREATE OR REPLACE TRIGGER "trg_invoices_updated_at" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_manual_subscription_payments_updated_at" BEFORE UPDATE ON "public"."manual_subscription_payments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_payments_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_phase5e_categories_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id", "parent_id" ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_category_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_customers_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id" ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_customer_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_expenses_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id", "category_id" ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_expense_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_fixed_expenses_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id", "category_id" ON "public"."fixed_expenses" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_expense_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_inventory_items_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id", "category_id", "supplier_id" ON "public"."inventory_items" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_inventory_item_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_products_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id", "category_id" ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_product_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_purchase_items_scope" BEFORE INSERT OR UPDATE OF "purchase_id", "inventory_item_id" ON "public"."purchase_items" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_purchase_item_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_purchases_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id", "supplier_id" ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_purchase_scope"();



CREATE OR REPLACE TRIGGER "trg_phase5e_suppliers_scope" BEFORE INSERT OR UPDATE OF "tenant_id", "branch_id" ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."phase5e_validate_supplier_scope"();



CREATE OR REPLACE TRIGGER "trg_products_sku_normalize_generate" BEFORE INSERT OR UPDATE OF "sku" ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."products_sku_normalize_generate_trigger"();



CREATE OR REPLACE TRIGGER "trg_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_subscription_plans_updated_at" BEFORE UPDATE ON "public"."subscription_plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_queue_updated_at" BEFORE UPDATE ON "public"."sync_queue" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tenant_last_active" AFTER INSERT ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."update_tenant_last_active"();



CREATE OR REPLACE TRIGGER "trg_tenant_onboarding_status_updated_at" BEFORE UPDATE ON "public"."tenant_onboarding_status" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tenant_subs_updated_at" BEFORE UPDATE ON "public"."tenant_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tenants_updated_at" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_user_profiles_001_self_update_lockdown" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_user_profile_self_privilege_changes"();



CREATE OR REPLACE TRIGGER "trg_user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_zatca_certs_updated_at" BEFORE UPDATE ON "public"."zatca_certificates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_zatca_prod_credentials_updated_at" BEFORE UPDATE ON "public"."zatca_production_credentials" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."branch_login_usernames"
    ADD CONSTRAINT "branch_login_usernames_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branch_login_usernames"
    ADD CONSTRAINT "branch_login_usernames_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branch_login_usernames"
    ADD CONSTRAINT "branch_login_usernames_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branch_login_usernames"
    ADD CONSTRAINT "branch_login_usernames_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branch_login_usernames"
    ADD CONSTRAINT "branch_login_usernames_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."day_closings"
    ADD CONSTRAINT "day_closings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."day_closings"
    ADD CONSTRAINT "day_closings_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."day_closings"
    ADD CONSTRAINT "day_closings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."pos_sessions"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fixed_expenses"
    ADD CONSTRAINT "fixed_expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fixed_expenses"
    ADD CONSTRAINT "fixed_expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fixed_expenses"
    ADD CONSTRAINT "fixed_expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_original_invoice_item_id_fkey" FOREIGN KEY ("original_invoice_item_id") REFERENCES "public"."invoice_items"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."pos_sessions"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manual_subscription_payments"
    ADD CONSTRAINT "manual_subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."tenant_subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."manual_subscription_payments"
    ADD CONSTRAINT "manual_subscription_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manual_subscription_payments"
    ADD CONSTRAINT "manual_subscription_payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_credit_note_invoice_id_fkey" FOREIGN KEY ("credit_note_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_sessions"
    ADD CONSTRAINT "pos_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_sessions"
    ADD CONSTRAINT "pos_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."pos_sessions"
    ADD CONSTRAINT "pos_sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."pos_stock_movements"
    ADD CONSTRAINT "pos_stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_stock_movements"
    ADD CONSTRAINT "pos_stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_stock_movements"
    ADD CONSTRAINT "pos_stock_movements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_stock_movements"
    ADD CONSTRAINT "pos_stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_stock_movements"
    ADD CONSTRAINT "pos_stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_sku_counters"
    ADD CONSTRAINT "product_sku_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_stock_receipts"
    ADD CONSTRAINT "product_stock_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_stock_receipts"
    ADD CONSTRAINT "product_stock_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_stock_receipts"
    ADD CONSTRAINT "product_stock_receipts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_stock_receipts"
    ADD CONSTRAINT "product_stock_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_stock_receipts"
    ADD CONSTRAINT "product_stock_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_reversal_of_fkey" FOREIGN KEY ("reversal_of") REFERENCES "public"."purchase_stock_movements"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_stock_movements"
    ADD CONSTRAINT "purchase_stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."security_rate_limits"
    ADD CONSTRAINT "security_rate_limits_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."security_rate_limits"
    ADD CONSTRAINT "security_rate_limits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."security_rate_limits"
    ADD CONSTRAINT "security_rate_limits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_matched_inventory_item_id_fkey" FOREIGN KEY ("matched_inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_matched_product_id_fkey" FOREIGN KEY ("matched_product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_item_mappings"
    ADD CONSTRAINT "supplier_item_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_queue"
    ADD CONSTRAINT "sync_queue_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_queue"
    ADD CONSTRAINT "sync_queue_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_queue"
    ADD CONSTRAINT "sync_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_onboarding_status"
    ADD CONSTRAINT "tenant_onboarding_status_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_onboarding_status"
    ADD CONSTRAINT "tenant_onboarding_status_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_last_payment_id_fkey" FOREIGN KEY ("last_payment_id") REFERENCES "public"."manual_subscription_payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id");



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_support_notes"
    ADD CONSTRAINT "tenant_support_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_support_notes"
    ADD CONSTRAINT "tenant_support_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zatca_certificates"
    ADD CONSTRAINT "zatca_certificates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zatca_certificates"
    ADD CONSTRAINT "zatca_certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zatca_production_credentials"
    ADD CONSTRAINT "zatca_production_credentials_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zatca_production_credentials"
    ADD CONSTRAINT "zatca_production_credentials_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."zatca_production_credentials"
    ADD CONSTRAINT "zatca_production_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zatca_production_credentials"
    ADD CONSTRAINT "zatca_production_credentials_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE "public"."audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_login_usernames" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "branch_login_usernames_self_read" ON "public"."branch_login_usernames" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "branch_login_usernames_service_role_all" ON "public"."branch_login_usernames" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "branch_login_usernames_tenant_admin_manage" ON "public"."branch_login_usernames" TO "authenticated" USING ("public"."can_manage_branch_login_username"("tenant_id")) WITH CHECK ("public"."can_manage_branch_login_username"("tenant_id"));



CREATE POLICY "branch_pos_sessions_insert" ON "public"."pos_sessions" FOR INSERT WITH CHECK (("branch_id" IN ( SELECT "user_profiles"."branch_id"
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."branch_id" IS NOT NULL)))));



CREATE POLICY "branch_pos_sessions_select" ON "public"."pos_sessions" FOR SELECT USING (("branch_id" IN ( SELECT "user_profiles"."branch_id"
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."branch_id" IS NOT NULL)))));



CREATE POLICY "branch_pos_sessions_update" ON "public"."pos_sessions" FOR UPDATE USING (("branch_id" IN ( SELECT "user_profiles"."branch_id"
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."branch_id" IS NOT NULL)))));



ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."day_closings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fixed_expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."manual_subscription_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manual_subscription_payments_owner_read" ON "public"."manual_subscription_payments" FOR SELECT TO "authenticated" USING ((("tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['owner'::"text"]))));



CREATE POLICY "manual_subscription_payments_service_role_all" ON "public"."manual_subscription_payments" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "manual_subscription_payments_super_admin_all" ON "public"."manual_subscription_payments" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "owner_pos_sessions_select" ON "public"."pos_sessions" FOR SELECT USING (("tenant_id" IN ( SELECT "user_profiles"."tenant_id"
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."role" = 'owner'::"public"."user_role")))));



ALTER TABLE "public"."payment_refunds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phase3a_branches_insert" ON "public"."branches" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_branches_select" ON "public"."branches" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "id"));



CREATE POLICY "phase3a_branches_update" ON "public"."branches" FOR UPDATE TO "authenticated" USING (("public"."rls_can_manage_tenant"("tenant_id") OR ("public"."rls_is_branch_staff"() AND ("tenant_id" = "public"."rls_current_tenant_id"()) AND ("id" = "public"."rls_current_branch_id"())))) WITH CHECK (("public"."rls_can_manage_tenant"("tenant_id") OR ("public"."rls_is_branch_staff"() AND ("tenant_id" = "public"."rls_current_tenant_id"()) AND ("id" = "public"."rls_current_branch_id"()))));



CREATE POLICY "phase3a_categories_delete" ON "public"."categories" FOR DELETE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_categories_insert" ON "public"."categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_categories_select" ON "public"."categories" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_categories_update" ON "public"."categories" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_customers_delete" ON "public"."customers" FOR DELETE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_customers_insert" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_customers_select" ON "public"."customers" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_customers_update" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_day_closings_delete" ON "public"."day_closings" FOR DELETE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_day_closings_insert" ON "public"."day_closings" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_day_closings_select" ON "public"."day_closings" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_day_closings_update" ON "public"."day_closings" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_employees_delete" ON "public"."employees" FOR DELETE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_employees_insert" ON "public"."employees" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_employees_select" ON "public"."employees" FOR SELECT TO "authenticated" USING (("public"."rls_can_manage_tenant"("tenant_id") OR (("tenant_id" = "public"."rls_current_tenant_id"()) AND ("branch_id" = "public"."rls_current_branch_id"()) AND "public"."rls_is_branch_staff"())));



CREATE POLICY "phase3a_employees_update" ON "public"."employees" FOR UPDATE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id")) WITH CHECK ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_expense_categories_delete" ON "public"."expense_categories" FOR DELETE TO "authenticated" USING (("public"."rls_can_manage_tenant"("tenant_id") AND ("is_system" IS FALSE)));



CREATE POLICY "phase3a_expense_categories_insert" ON "public"."expense_categories" FOR INSERT TO "authenticated" WITH CHECK (("public"."rls_can_manage_tenant"("tenant_id") AND ("is_system" IS FALSE)));



CREATE POLICY "phase3a_expense_categories_select" ON "public"."expense_categories" FOR SELECT TO "authenticated" USING ((("is_system" IS TRUE) OR ("tenant_id" IS NULL) OR "public"."rls_can_access_tenant"("tenant_id")));



CREATE POLICY "phase3a_expense_categories_update" ON "public"."expense_categories" FOR UPDATE TO "authenticated" USING (("public"."rls_can_manage_tenant"("tenant_id") AND ("is_system" IS FALSE))) WITH CHECK (("public"."rls_can_manage_tenant"("tenant_id") AND ("is_system" IS FALSE)));



CREATE POLICY "phase3a_expenses_delete" ON "public"."expenses" FOR DELETE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_expenses_insert" ON "public"."expenses" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_expenses_select" ON "public"."expenses" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_expenses_update" ON "public"."expenses" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_fixed_expenses_delete" ON "public"."fixed_expenses" FOR DELETE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_fixed_expenses_insert" ON "public"."fixed_expenses" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_fixed_expenses_select" ON "public"."fixed_expenses" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_fixed_expenses_update" ON "public"."fixed_expenses" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_inventory_items_delete" ON "public"."inventory_items" FOR DELETE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_inventory_items_insert" ON "public"."inventory_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_inventory_items_select" ON "public"."inventory_items" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_inventory_items_update" ON "public"."inventory_items" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_payment_refunds_select" ON "public"."payment_refunds" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_pos_stock_movements_service_all" ON "public"."pos_stock_movements" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase3a_products_delete" ON "public"."products" FOR DELETE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_products_insert" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_products_select" ON "public"."products" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_products_update" ON "public"."products" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_purchase_items_delete" ON "public"."purchase_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."purchases" "p"
  WHERE (("p"."id" = "purchase_items"."purchase_id") AND "public"."rls_can_write_branch"("p"."tenant_id", "p"."branch_id")))));



CREATE POLICY "phase3a_purchase_items_insert" ON "public"."purchase_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."purchases" "p"
  WHERE (("p"."id" = "purchase_items"."purchase_id") AND "public"."rls_can_write_branch"("p"."tenant_id", "p"."branch_id")))));



CREATE POLICY "phase3a_purchase_items_select" ON "public"."purchase_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."purchases" "p"
  WHERE (("p"."id" = "purchase_items"."purchase_id") AND "public"."rls_can_access_branch"("p"."tenant_id", "p"."branch_id")))));



CREATE POLICY "phase3a_purchase_items_update" ON "public"."purchase_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."purchases" "p"
  WHERE (("p"."id" = "purchase_items"."purchase_id") AND "public"."rls_can_write_branch"("p"."tenant_id", "p"."branch_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."purchases" "p"
  WHERE (("p"."id" = "purchase_items"."purchase_id") AND "public"."rls_can_write_branch"("p"."tenant_id", "p"."branch_id")))));



CREATE POLICY "phase3a_purchases_delete" ON "public"."purchases" FOR DELETE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_purchases_insert" ON "public"."purchases" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_purchases_select" ON "public"."purchases" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_purchases_update" ON "public"."purchases" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_subscription_plans_read" ON "public"."subscription_plans" FOR SELECT TO "authenticated", "anon" USING ((("is_active" IS TRUE) OR "public"."rls_is_super_admin"()));



CREATE POLICY "phase3a_subscription_plans_super_delete" ON "public"."subscription_plans" FOR DELETE TO "authenticated" USING ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_subscription_plans_super_insert" ON "public"."subscription_plans" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_subscription_plans_super_update" ON "public"."subscription_plans" FOR UPDATE TO "authenticated" USING ("public"."rls_is_super_admin"()) WITH CHECK ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_suppliers_delete" ON "public"."suppliers" FOR DELETE TO "authenticated" USING ("public"."rls_can_manage_tenant"("tenant_id"));



CREATE POLICY "phase3a_suppliers_insert" ON "public"."suppliers" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_suppliers_select" ON "public"."suppliers" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_suppliers_update" ON "public"."suppliers" FOR UPDATE TO "authenticated" USING ("public"."rls_can_write_branch"("tenant_id", "branch_id")) WITH CHECK ("public"."rls_can_write_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_sync_queue_service_all" ON "public"."sync_queue" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase3a_tenant_subscriptions_select" ON "public"."tenant_subscriptions" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_tenant"("tenant_id"));



CREATE POLICY "phase3a_tenant_subscriptions_super_delete" ON "public"."tenant_subscriptions" FOR DELETE TO "authenticated" USING ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_tenant_subscriptions_super_insert" ON "public"."tenant_subscriptions" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_tenant_subscriptions_super_update" ON "public"."tenant_subscriptions" FOR UPDATE TO "authenticated" USING ("public"."rls_is_super_admin"()) WITH CHECK ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_tenants_select" ON "public"."tenants" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_tenant"("id"));



CREATE POLICY "phase3a_tenants_super_delete" ON "public"."tenants" FOR DELETE TO "authenticated" USING ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_tenants_super_insert" ON "public"."tenants" FOR INSERT TO "authenticated" WITH CHECK ("public"."rls_is_super_admin"());



CREATE POLICY "phase3a_tenants_update" ON "public"."tenants" FOR UPDATE TO "authenticated" USING ("public"."rls_can_manage_tenant"("id")) WITH CHECK ("public"."rls_can_manage_tenant"("id"));



CREATE POLICY "phase3a_user_profiles_own_update" ON "public"."user_profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "phase3a_user_profiles_select" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."rls_is_super_admin"() OR (("tenant_id" = "public"."rls_current_tenant_id"()) AND "public"."rls_is_tenant_admin"()) OR (("tenant_id" = "public"."rls_current_tenant_id"()) AND ("branch_id" = "public"."rls_current_branch_id"()) AND "public"."rls_is_branch_staff"())));



CREATE POLICY "phase3a_zatca_certificates_safe_select" ON "public"."zatca_certificates" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase3a_zatca_production_credentials_service_all" ON "public"."zatca_production_credentials" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase3c_audit_events_select" ON "public"."audit_events" FOR SELECT TO "authenticated" USING (("public"."rls_is_super_admin"() OR "public"."rls_can_manage_tenant"("tenant_id") OR (("branch_id" IS NOT NULL) AND "public"."rls_is_branch_staff"() AND "public"."rls_can_access_branch"("tenant_id", "branch_id"))));



CREATE POLICY "phase3c_audit_events_service_all" ON "public"."audit_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase3c_rate_limits_service_all" ON "public"."security_rate_limits" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase4c_purchase_stock_movements_select" ON "public"."purchase_stock_movements" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase4c_purchase_stock_movements_service_all" ON "public"."purchase_stock_movements" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase4c_supplier_item_mappings_select" ON "public"."supplier_item_mappings" FOR SELECT TO "authenticated" USING ("public"."rls_can_access_branch"("tenant_id", "branch_id"));



CREATE POLICY "phase4c_supplier_item_mappings_service_all" ON "public"."supplier_item_mappings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase4d_supplier_item_mappings_select" ON "public"."supplier_item_mappings" FOR SELECT TO "authenticated" USING (((("branch_id" IS NULL) AND "public"."rls_can_access_tenant"("tenant_id")) OR (("branch_id" IS NOT NULL) AND "public"."rls_can_access_branch"("tenant_id", "branch_id"))));



CREATE POLICY "phase4d_supplier_item_mappings_service_all" ON "public"."supplier_item_mappings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "phase5b_invoice_items_select" ON "public"."invoice_items" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "invoice_items"."invoice_id") AND ((("i"."tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['owner'::"text"]))) OR (("i"."tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['branch'::"text"])) AND ("i"."branch_id" = "public"."get_my_branch_id"()))))))));



COMMENT ON POLICY "phase5b_invoice_items_select" ON "public"."invoice_items" IS 'Phase 5B: authenticated users may read scoped invoice items via parent invoice only; direct browser writes are blocked.';



CREATE POLICY "phase5b_invoices_select" ON "public"."invoices" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR (("tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['owner'::"text"]))) OR (("tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['branch'::"text"])) AND ("branch_id" = "public"."get_my_branch_id"()))));



COMMENT ON POLICY "phase5b_invoices_select" ON "public"."invoices" IS 'Phase 5B: authenticated users may read scoped invoices only; direct browser writes are blocked.';



CREATE POLICY "phase5b_payments_select" ON "public"."payments" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "payments"."invoice_id") AND ((("i"."tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['owner'::"text"]))) OR (("i"."tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['branch'::"text"])) AND ("i"."branch_id" = "public"."get_my_branch_id"()))))))));



COMMENT ON POLICY "phase5b_payments_select" ON "public"."payments" IS 'Phase 5B: authenticated users may read scoped payments via parent invoice only; direct browser writes are blocked.';



ALTER TABLE "public"."pos_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_stock_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."security_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_item_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_onboarding_status" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_onboarding_status_owner_read" ON "public"."tenant_onboarding_status" FOR SELECT TO "authenticated" USING ((("tenant_id" = "public"."get_my_tenant_id"()) AND (("public"."get_my_role"())::"text" = ANY (ARRAY['owner'::"text"]))));



CREATE POLICY "tenant_onboarding_status_service_role_all" ON "public"."tenant_onboarding_status" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "tenant_onboarding_status_super_admin_all" ON "public"."tenant_onboarding_status" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



ALTER TABLE "public"."tenant_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_support_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_support_notes_service_role_all" ON "public"."tenant_support_notes" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "tenant_support_notes_super_admin_all" ON "public"."tenant_support_notes" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zatca_certificates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zatca_production_credentials" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."assert_product_write_access"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_product_write_access"("p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_actor_role"("p_actor_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_actor_role"("p_actor_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_branch_write_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_branch_write_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_invoice_insert_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_invoice_insert_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_purchase_write_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_purchase_write_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_safe_metadata"("p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_safe_metadata"("p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_storage_object_write_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_storage_object_write_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_user_profile_write_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_user_profile_write_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_create_branch"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_create_branch"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_create_branch"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_branch_login_username"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_branch_login_username"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_branch_login_username"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_purchase_receiving"("p_purchase_id" "uuid", "p_reason" "text", "p_confirm" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_purchase_receiving"("p_purchase_id" "uuid", "p_reason" "text", "p_confirm" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_purchase_receiving"("p_purchase_id" "uuid", "p_reason" "text", "p_confirm" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_register_session"("p_session_id" "uuid", "p_actual_cash" numeric, "p_closing_checks" "jsonb", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_register_session"("p_session_id" "uuid", "p_actual_cash" numeric, "p_closing_checks" "jsonb", "p_notes" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."complete_onboarding"("p_company_name" "text", "p_company_name_ar" "text", "p_vat_number" "text", "p_cr_number" "text", "p_city" "text", "p_country" "text", "p_phone" "text", "p_website" "text", "p_plan_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirm_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirm_purchase_receiving_unchecked"("p_purchase_id" "uuid", "p_confirm" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_purchase_receiving_unchecked"("p_purchase_id" "uuid", "p_confirm" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_purchase_receiving_unchecked"("p_purchase_id" "uuid", "p_confirm" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_rate_limit"("p_action" "text", "p_scope" "text", "p_scope_id" "text", "p_max_attempts" integer, "p_window_seconds" integer, "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_target_type" "text", "p_target_id" "uuid", "p_metadata" "jsonb", "p_ip_hash" "text", "p_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_rate_limit"("p_action" "text", "p_scope" "text", "p_scope_id" "text", "p_max_attempts" integer, "p_window_seconds" integer, "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_target_type" "text", "p_target_id" "uuid", "p_metadata" "jsonb", "p_ip_hash" "text", "p_request_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_branch_for_tenant"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_branch_for_tenant"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_full_credit_note"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_full_credit_note"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_full_credit_note_unchecked"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_full_credit_note_unchecked"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_full_credit_note_unchecked"("p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_partial_credit_note"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_partial_credit_note"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_partial_credit_note_with_refund"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_partial_credit_note_with_refund"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_product_secure"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_product_secure"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_purchase_bill"("p_purchase_id" "uuid", "p_confirm" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_purchase_bill"("p_purchase_id" "uuid", "p_confirm" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_purchase_receiving"("p_purchase_id" "uuid", "p_confirm" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."enforce_branch_creation_limit_and_suspension"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."get_branch_dashboard_recent_invoices"("p_branch_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_branch_dashboard_recent_invoices"("p_branch_id" "uuid", "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_customer_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_customer_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dashboard_summary"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_summary"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_expense_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_expense_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_invoice_refundable_items"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_invoice_refundable_items"("p_invoice_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_branch_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_branch_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_tenant_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_tenant_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_next_credit_note_counter"("p_branch_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."get_profit_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profit_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_purchase_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_purchase_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_register_session_summary"("p_branch_id" "uuid", "p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_register_session_summary"("p_branch_id" "uuid", "p_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_register_sessions"("p_branch_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_register_sessions"("p_branch_id" "uuid", "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_register_sessions_filtered"("p_branch_id" "uuid", "p_limit" integer, "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_register_sessions_filtered"("p_branch_id" "uuid", "p_limit" integer, "p_start_date" "date", "p_end_date" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_sales_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sales_report_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_super_admin_clients_billing_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_super_admin_clients_billing_summary"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_supplier_purchase_totals"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_supplier_purchase_totals"("p_branch_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_tenant_branch_usage"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tenant_branch_usage"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tenant_branch_usage"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tenant_subscription_access"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tenant_subscription_access"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tenant_subscription_access"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_vat_support_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_vat_support_summary"("p_start_date" "date", "p_end_date" "date", "p_branch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_reserved_branch_login_username"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_reserved_branch_login_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_reserved_branch_login_username"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_valid_branch_login_username"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_valid_branch_login_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_valid_branch_login_username"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_zatca_certificate_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_zatca_certificate_status"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_owner_setup_complete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_owner_setup_complete"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."next_product_sku"("p_tenant_id" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_product_sku"("p_tenant_id" "uuid", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_branch_login_username"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_branch_login_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_branch_login_username"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_product_sku"("p_sku" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_product_sku"("p_sku" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_product_sku"("p_sku" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_supplier_item_name"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_supplier_item_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_supplier_item_name"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_register_session"("p_branch_id" "uuid", "p_opening_cash" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_register_session"("p_branch_id" "uuid", "p_opening_cash" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."peek_product_sku"("p_tenant_id" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."peek_product_sku"("p_tenant_id" "uuid", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase5e_assert_branch_scope"("p_tenant_id" "uuid", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase5e_assert_branch_scope"("p_tenant_id" "uuid", "p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase5e_assert_optional_branch_fk"("p_table" "text", "p_id" "uuid", "p_label" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_allow_tenant_wide" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase5e_assert_optional_branch_fk"("p_table" "text", "p_id" "uuid", "p_label" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_allow_tenant_wide" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase5e_column_exists"("p_table" "text", "p_column" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase5e_column_exists"("p_table" "text", "p_column" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase5e_validate_category_scope"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase5e_validate_category_scope"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase5e_validate_customer_scope"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."phase5e_validate_expense_scope"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."phase5e_validate_inventory_item_scope"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."phase5e_validate_product_scope"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase5e_validate_product_scope"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase5e_validate_purchase_item_scope"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."phase5e_validate_purchase_scope"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase5e_validate_purchase_scope"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase5e_validate_supplier_scope"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."pos_checkout"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pos_checkout"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."product_rpc_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."product_rpc_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."product_sku_prefix"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."product_sku_prefix"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_sku_prefix"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."products_sku_normalize_generate_trigger"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."products_sku_normalize_generate_trigger"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purchase_bill_path_is_valid"("p_tenant_id" "uuid", "p_branch_id" "uuid", "p_bill_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purchase_bill_path_is_valid"("p_tenant_id" "uuid", "p_branch_id" "uuid", "p_bill_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purchase_edit_window_days"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purchase_edit_window_days"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_edit_window_days"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purchase_is_in_edit_window"("p_purchase_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purchase_is_in_edit_window"("p_purchase_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_is_in_edit_window"("p_purchase_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."receive_product_stock"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."receive_product_stock"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_audit_event"("p_action" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_target_type" "text", "p_target_id" "uuid", "p_severity" "text", "p_status" "text", "p_metadata" "jsonb", "p_ip_hash" "text", "p_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_audit_event"("p_action" "text", "p_tenant_id" "uuid", "p_branch_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_target_type" "text", "p_target_id" "uuid", "p_severity" "text", "p_status" "text", "p_metadata" "jsonb", "p_ip_hash" "text", "p_request_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_purchase_attachment_viewed"("p_purchase_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_purchase_attachment_viewed"("p_purchase_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reporting_resolve_scope"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reporting_resolve_scope"("p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_can_access_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_can_access_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rls_can_access_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_can_access_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_can_access_tenant"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_can_access_tenant"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rls_can_access_tenant"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_can_access_tenant"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_can_manage_tenant"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_can_manage_tenant"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rls_can_manage_tenant"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_can_manage_tenant"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_can_write_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_can_write_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rls_can_write_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_can_write_branch"("p_tenant_id" "uuid", "p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_current_branch_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_current_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_current_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_current_branch_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_current_role_text"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_current_role_text"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_current_role_text"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_current_role_text"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_current_tenant_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_current_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_current_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_current_tenant_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_is_branch_staff"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_is_branch_staff"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_is_branch_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_is_branch_staff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_is_super_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_is_tenant_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_is_tenant_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_is_tenant_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_is_tenant_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_purchase_bill_attachment"("p_purchase_id" "uuid", "p_bill_path" "text", "p_clear" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_purchase_bill_attachment"("p_purchase_id" "uuid", "p_bill_path" "text", "p_clear" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."suggest_product_sku"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."suggest_product_sku"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."suggest_supplier_item_mapping"("p_supplier_id" "uuid", "p_supplier_item_name" "text", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."suggest_supplier_item_mapping"("p_supplier_id" "uuid", "p_supplier_item_name" "text", "p_branch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_branch_invoice_settings"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_branch_invoice_settings"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_branch_module_settings"("p_branch_id" "uuid", "p_stock_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_branch_module_settings"("p_branch_id" "uuid", "p_stock_enabled" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_branch_pos_settings"("p_branch_id" "uuid", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_branch_pos_settings"("p_branch_id" "uuid", "p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_product_secure"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_product_secure"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_product_stock_settings"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_product_stock_settings"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_purchase_entry"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_purchase_entry"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."upsert_supplier_item_mapping"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_supplier_item_mapping"("p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."validate_branch_login_username_scope"() FROM PUBLIC;



GRANT ALL ON TABLE "public"."audit_events" TO "service_role";
GRANT SELECT ON TABLE "public"."audit_events" TO "authenticated";



GRANT ALL ON TABLE "public"."branch_login_usernames" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_login_usernames" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "service_role";
GRANT SELECT ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("tenant_id") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("name"),UPDATE("name") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("name_ar"),UPDATE("name_ar") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("branch_code"),UPDATE("branch_code") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("phone"),UPDATE("phone") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("email"),UPDATE("email") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("address"),UPDATE("address") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("address_ar"),UPDATE("address_ar") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("building_number"),UPDATE("building_number") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("additional_number"),UPDATE("additional_number") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("street"),UPDATE("street") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("street_ar"),UPDATE("street_ar") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("district"),UPDATE("district") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("district_ar"),UPDATE("district_ar") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("city"),UPDATE("city") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("city_ar"),UPDATE("city_ar") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("country"),UPDATE("country") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("postal_code"),UPDATE("postal_code") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("is_main_branch"),UPDATE("is_main_branch") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("is_active"),UPDATE("is_active") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("business_name"),UPDATE("business_name") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("business_name_ar"),UPDATE("business_name_ar") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("vat_number"),UPDATE("vat_number") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("cr_number"),UPDATE("cr_number") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("logo_url"),UPDATE("logo_url") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("website"),UPDATE("website") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("vat_mode"),UPDATE("vat_mode") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("invoice_prefix"),UPDATE("invoice_prefix") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("receipt_footer"),UPDATE("receipt_footer") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("show_logo"),UPDATE("show_logo") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("invoice_language"),UPDATE("invoice_language") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("zatca_phase"),UPDATE("zatca_phase") ON TABLE "public"."branches" TO "authenticated";



GRANT INSERT("branch_email"),UPDATE("branch_email") ON TABLE "public"."branches" TO "authenticated";



GRANT ALL ON TABLE "public"."categories" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."categories" TO "authenticated";



GRANT ALL ON TABLE "public"."customers" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."customers" TO "authenticated";



GRANT ALL ON TABLE "public"."day_closings" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."day_closings" TO "authenticated";



GRANT ALL ON TABLE "public"."employees" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."employees" TO "authenticated";



GRANT ALL ON TABLE "public"."expense_categories" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."expense_categories" TO "authenticated";



GRANT ALL ON TABLE "public"."expenses" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."expenses" TO "authenticated";



GRANT ALL ON TABLE "public"."fixed_expenses" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."fixed_expenses" TO "authenticated";



GRANT ALL ON TABLE "public"."inventory_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."inventory_items" TO "authenticated";



GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";
GRANT SELECT ON TABLE "public"."invoice_items" TO "authenticated";



GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("tenant_id") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("branch_id") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("customer_id") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("created_by") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("invoice_number") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("invoice_reference") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_uuid") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_invoice_type") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_type_code") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_counter_number") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_prev_invoice_hash") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_xml_hash") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_qr_code"),UPDATE("zatca_qr_code") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_status") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_submission_id") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_submitted_at") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_clearance_status") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("zatca_warnings") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("subtotal") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("discount_amount") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("taxable_amount") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("tax_amount") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("total_amount") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("currency_code") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("invoice_date") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("supply_date") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("due_date") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("payment_status") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("notes") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("notes_ar") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("cancelled_at") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("cancellation_reason") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("session_id") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("payment_method") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("checkout_idempotency_key") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("original_invoice_id") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("credit_reason") ON TABLE "public"."invoices" TO "authenticated";



GRANT SELECT("credit_note_idempotency_key") ON TABLE "public"."invoices" TO "authenticated";



GRANT ALL ON TABLE "public"."manual_subscription_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."manual_subscription_payments" TO "service_role";



GRANT ALL ON TABLE "public"."payment_refunds" TO "service_role";
GRANT SELECT ON TABLE "public"."payment_refunds" TO "authenticated";



GRANT ALL ON TABLE "public"."payments" TO "service_role";
GRANT SELECT ON TABLE "public"."payments" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_sessions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_sessions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pos_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."pos_stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."product_sku_counters" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_stock_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."product_stock_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."products" TO "authenticated";



GRANT ALL ON TABLE "public"."purchase_items" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."purchase_items" TO "authenticated";



GRANT ALL ON TABLE "public"."purchase_stock_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."purchase_stock_movements" TO "authenticated";



GRANT ALL ON TABLE "public"."purchases" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."purchases" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reporting_counted_purchases_v" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reporting_expenses_v" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reporting_invoice_documents_v" TO "service_role";



GRANT ALL ON TABLE "public"."security_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";
GRANT SELECT ON TABLE "public"."subscription_plans" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."subscription_plans" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_item_mappings" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_item_mappings" TO "authenticated";



GRANT ALL ON TABLE "public"."suppliers" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."suppliers" TO "authenticated";



GRANT ALL ON TABLE "public"."sync_queue" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_onboarding_status" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_onboarding_status" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_subscriptions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tenant_subscriptions" TO "authenticated";



GRANT ALL ON TABLE "public"."tenant_support_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_support_notes" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tenants" TO "authenticated";



GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."user_profiles" TO "authenticated";



GRANT UPDATE("full_name") ON TABLE "public"."user_profiles" TO "authenticated";



GRANT UPDATE("full_name_ar") ON TABLE "public"."user_profiles" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."user_profiles" TO "authenticated";



GRANT UPDATE("avatar_url") ON TABLE "public"."user_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."zatca_certificates" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("tenant_id") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("branch_id") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("environment") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("serial_number") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("valid_from") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("valid_to") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("invoice_counter") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT SELECT("activated_at") ON TABLE "public"."zatca_certificates" TO "authenticated";



GRANT ALL ON TABLE "public"."zatca_production_credentials" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";







