-- ============================================================
-- Phase 3C rate-limit and audit logging foundation
-- Apply manually in Supabase SQL editor after Phase 3B.
-- ============================================================
--
-- Goals:
--   - Add safe audit logging for sensitive app actions.
--   - Add DB-backed rate-limit counters for Edge Function enforcement.
--   - Preserve working POS checkout, credit note, and ZATCA flows.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.
--   - This patch does not change onboarding, OTPs, or production credentials.
--
-- Design notes:
--   - Edge Functions call public.consume_rate_limit() before expensive or
--     destructive actions. Those calls are separate DB transactions, so denied
--     attempts remain counted.
--   - POS checkout and credit note RPCs are audit-first in this patch via
--     invoice INSERT triggers. Enforcing SQL-RPC rate limits safely would
--     require a larger RPC rewrite that returns safe JSON errors instead of
--     raising exceptions that roll back rate-limit counters.
--   - Metadata is intentionally small and top-level sensitive keys are removed.

BEGIN;

-- ============================================================
-- Audit and rate-limit tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_events (
  id              UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id       UUID,
  branch_id       UUID,
  actor_user_id   UUID,
  actor_role      TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       UUID,
  severity        TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  status          TEXT NOT NULL DEFAULT 'attempted'
                  CHECK (status IN ('attempted', 'succeeded', 'failed', 'blocked')),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash         TEXT,
  request_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_tenant_id_fkey,
  DROP CONSTRAINT IF EXISTS audit_events_branch_id_fkey,
  DROP CONSTRAINT IF EXISTS audit_events_actor_user_id_fkey;

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON public.audit_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_branch_created_idx
  ON public.audit_events (branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_actor_created_idx
  ON public.audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_action_created_idx
  ON public.audit_events (action, created_at DESC);

CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  id              UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  action          TEXT NOT NULL,
  scope           TEXT NOT NULL,
  scope_id        TEXT NOT NULL,
  tenant_id       UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id       UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  target_type     TEXT,
  target_id       UUID,
  window_start    TIMESTAMPTZ NOT NULL,
  window_seconds  INTEGER NOT NULL CHECK (window_seconds > 0),
  max_attempts    INTEGER NOT NULL CHECK (max_attempts > 0),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT security_rate_limits_unique_window
    UNIQUE (action, scope, scope_id, window_start, window_seconds)
);

CREATE INDEX IF NOT EXISTS security_rate_limits_tenant_window_idx
  ON public.security_rate_limits (tenant_id, action, window_start DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS security_rate_limits_branch_window_idx
  ON public.security_rate_limits (branch_id, action, window_start DESC)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS security_rate_limits_actor_window_idx
  ON public.security_rate_limits (actor_user_id, action, window_start DESC)
  WHERE actor_user_id IS NOT NULL;

COMMENT ON TABLE public.audit_events IS
  'Safe security/audit event log. Do not store secrets, OTPs, auth headers, private keys, raw XML, or full request bodies.';

COMMENT ON TABLE public.security_rate_limits IS
  'DB-backed action counters used by Edge Functions and future safe RPC wrappers.';

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.security_rate_limits FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.audit_events TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.audit_events TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.security_rate_limits TO service_role;

DROP POLICY IF EXISTS phase3c_audit_events_select ON public.audit_events;
DROP POLICY IF EXISTS phase3c_audit_events_service_all ON public.audit_events;
DROP POLICY IF EXISTS phase3c_rate_limits_service_all ON public.security_rate_limits;

CREATE POLICY phase3c_audit_events_select
  ON public.audit_events
  FOR SELECT TO authenticated
  USING (
    public.rls_is_super_admin()
    OR public.rls_can_manage_tenant(tenant_id)
    OR (
      branch_id IS NOT NULL
      AND public.rls_is_branch_staff()
      AND public.rls_can_access_branch(tenant_id, branch_id)
    )
  );

CREATE POLICY phase3c_audit_events_service_all
  ON public.audit_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY phase3c_rate_limits_service_all
  ON public.security_rate_limits
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Audit/rate helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_safe_metadata(p_metadata JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.audit_actor_role(p_actor_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.role::text
  FROM public.user_profiles up
  WHERE up.id = p_actor_user_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.record_audit_event(
  p_action TEXT,
  p_tenant_id UUID DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL,
  p_actor_role TEXT DEFAULT NULL,
  p_target_type TEXT DEFAULT NULL,
  p_target_id UUID DEFAULT NULL,
  p_severity TEXT DEFAULT 'info',
  p_status TEXT DEFAULT 'attempted',
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ip_hash TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_action TEXT,
  p_scope TEXT,
  p_scope_id TEXT,
  p_max_attempts INTEGER,
  p_window_seconds INTEGER,
  p_tenant_id UUID DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL,
  p_actor_role TEXT DEFAULT NULL,
  p_target_type TEXT DEFAULT NULL,
  p_target_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ip_hash TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.audit_safe_metadata(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_actor_role(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_audit_event(TEXT, UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.audit_safe_metadata(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_actor_role(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_audit_event(TEXT, UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT, TEXT) TO service_role;

-- ============================================================
-- Audit triggers for RPC/direct DB mutations
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_invoice_insert_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS phase3c_audit_invoice_insert ON public.invoices;
CREATE TRIGGER phase3c_audit_invoice_insert
  AFTER INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_invoice_insert_event();

CREATE OR REPLACE FUNCTION public.audit_branch_write_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS phase3c_audit_branch_write ON public.branches;
CREATE TRIGGER phase3c_audit_branch_write
  AFTER INSERT OR UPDATE OR DELETE ON public.branches
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_branch_write_event();

CREATE OR REPLACE FUNCTION public.audit_user_profile_write_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS phase3c_audit_user_profile_write ON public.user_profiles;
CREATE TRIGGER phase3c_audit_user_profile_write
  AFTER INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_user_profile_write_event();

CREATE OR REPLACE FUNCTION public.audit_storage_object_write_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS phase3c_audit_storage_object_write ON storage.objects;
CREATE TRIGGER phase3c_audit_storage_object_write
  AFTER INSERT OR DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_storage_object_write_event();

REVOKE ALL ON FUNCTION public.audit_invoice_insert_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_branch_write_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_user_profile_write_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_storage_object_write_event() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.audit_invoice_insert_event() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_branch_write_event() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_user_profile_write_event() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_storage_object_write_event() TO service_role;

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm tables exist:
--
-- SELECT to_regclass('public.audit_events') AS audit_events,
--        to_regclass('public.security_rate_limits') AS security_rate_limits;
--
-- 2) Confirm browser roles cannot write audit/rate tables:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('audit_events', 'security_rate_limits')
--   AND grantee IN ('anon', 'authenticated')
-- ORDER BY table_name, grantee, privilege_type;
--
-- Expected: only authenticated SELECT on audit_events.
--
-- 3) Confirm RLS policies:
--
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('audit_events', 'security_rate_limits')
-- ORDER BY tablename, policyname;
--
-- 4) Confirm Edge helper RPC privileges:
--
-- SELECT
--   has_function_privilege('service_role', 'public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)', 'EXECUTE') AS service_can_audit,
--   has_function_privilege('service_role', 'public.consume_rate_limit(text, text, text, integer, integer, uuid, uuid, uuid, text, text, uuid, jsonb, text, text)', 'EXECUTE') AS service_can_rate_limit;
--
-- 5) Safe dry-run rate-limit probe from SQL editor:
--
-- SELECT public.consume_rate_limit(
--   'phase3c_probe',
--   'tenant',
--   'probe',
--   2,
--   60,
--   NULL,
--   NULL,
--   NULL,
--   NULL,
--   'probe',
--   NULL,
--   '{"safe":true}'::jsonb,
--   NULL,
--   NULL
-- );
--
-- 6) Confirm triggers are installed:
--
-- SELECT event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_name LIKE 'phase3c_audit_%'
-- ORDER BY event_object_schema, event_object_table, trigger_name, event_manipulation;

-- ============================================================
-- Manual test checklist after applying SQL and deploying functions
-- ============================================================
--
-- - POS checkout creates an audit_events row with action pos_checkout_created.
-- - Full credit note creates an audit_events row with action credit_note_created.
-- - Normal invoice ZATCA report creates attempted/succeeded or failed audit rows.
-- - Repeated ZATCA submit for one invoice eventually returns HTTP 429 safely.
-- - ZATCA onboarding attempt creates audit rows and rate-limit counters.
-- - ZATCA disconnect attempt/completion creates audit rows.
-- - Delete branch/tenant dry-run and real attempts create audit rows.
-- - Branch user creation/password reset creates audit rows after function deploy.
--
-- Recommended cleanup job:
--   DELETE FROM public.security_rate_limits
--   WHERE window_start < NOW() - INTERVAL '30 days';
--
-- Recommended retention policy:
--   Keep audit_events at least 180 days before archiving.
