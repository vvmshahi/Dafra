-- ============================================================
-- Phase 5Q: Secure permanent ZATCA Sandbox demo foundation
-- Apply manually after Phase 5O.
--
-- Foundation only: no demo tenant/branch creation, onboarding, or credentials.
-- ============================================================

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_single_permanent_demo_uidx
  ON public.tenants (is_demo)
  WHERE is_demo IS TRUE;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS zatca_environment TEXT NOT NULL DEFAULT 'production';

ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_zatca_environment_check;
ALTER TABLE public.branches
  ADD CONSTRAINT branches_zatca_environment_check
  CHECK (zatca_environment IN ('production', 'sandbox'));

COMMENT ON COLUMN public.tenants.is_demo IS
  'Server-managed marker for the single permanent Kubri public demo tenant.';
COMMENT ON COLUMN public.branches.zatca_environment IS
  'Server-managed ZATCA endpoint environment. Browser users cannot change this value.';

-- New permanent Sandbox credentials. Values prefixed encrypted_ must be

-- Backend-only encrypted Integration Sandbox credentials.
CREATE OR REPLACE FUNCTION public.is_valid_zatca_encrypted_envelope(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  v_parts TEXT[];
  v_iv BYTEA;
  v_ciphertext BYTEA;
BEGIN
  IF p_value !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$' THEN
    RETURN FALSE;
  END IF;
  v_parts := string_to_array(p_value, ':');
  IF array_length(v_parts, 1) <> 3 OR v_parts[1] <> 'v1' THEN
    RETURN FALSE;
  END IF;
  v_iv := decode(v_parts[2], 'base64');
  v_ciphertext := decode(v_parts[3], 'base64');
  RETURN octet_length(v_iv) = 12 AND octet_length(v_ciphertext) >= 16;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment = 'sandbox'),
  device_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  encrypted_private_key TEXT NOT NULL CHECK (public.is_valid_zatca_encrypted_envelope(encrypted_private_key)),
  encrypted_compliance_csid TEXT CHECK (encrypted_compliance_csid IS NULL OR public.is_valid_zatca_encrypted_envelope(encrypted_compliance_csid)),
  encrypted_compliance_secret TEXT CHECK (encrypted_compliance_secret IS NULL OR public.is_valid_zatca_encrypted_envelope(encrypted_compliance_secret)),
  encrypted_production_csid TEXT CHECK (encrypted_production_csid IS NULL OR public.is_valid_zatca_encrypted_envelope(encrypted_production_csid)),
  encrypted_production_secret TEXT CHECK (encrypted_production_secret IS NULL OR public.is_valid_zatca_encrypted_envelope(encrypted_production_secret)),
  certificate TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','compliance','active','revoked','expired','failed')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, environment, device_id),
  CONSTRAINT zatca_sandbox_active_submission_material_check CHECK (
    status <> 'active'
    OR (
      encrypted_private_key IS NOT NULL
      AND encrypted_production_csid IS NOT NULL
      AND encrypted_production_secret IS NOT NULL
      AND device_id IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS zatca_sandbox_credentials_one_active_uidx
  ON public.zatca_sandbox_credentials (tenant_id, branch_id, environment) WHERE status = 'active';

-- Isolated Sandbox demo invoice chain
-- ============================================================

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_chain_state (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment = 'sandbox'),
  device_id UUID NOT NULL,
  last_counter BIGINT NOT NULL DEFAULT 0 CHECK (last_counter >= 0),
  previous_hash TEXT NOT NULL DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, environment, device_id)
);

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_submission_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment = 'sandbox'),
  device_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  counter BIGINT NOT NULL CHECK (counter > 0),
  previous_hash TEXT NOT NULL,
  invoice_uuid UUID NOT NULL,
  invoice_hash TEXT,
  signed_xml TEXT,
  submission_payload JSONB,
  signature_value TEXT,
  qr_code TEXT,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN (
    'reserved', 'dispatched', 'accepted', 'rejected', 'ambiguous', 'cancelled_before_dispatch'
  )),
  endpoint_kind TEXT NOT NULL DEFAULT 'reporting' CHECK (endpoint_kind IN ('reporting', 'clearance')),
  response_status INTEGER,
  response_body JSONB,
  failure_reason TEXT,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id),
  UNIQUE (tenant_id, branch_id, environment, device_id, counter),
  FOREIGN KEY (tenant_id, branch_id, environment, device_id)
    REFERENCES public.zatca_sandbox_chain_state (tenant_id, branch_id, environment, device_id),
  CHECK (
    (invoice_hash IS NULL AND signed_xml IS NULL AND submission_payload IS NULL)
    OR (invoice_hash IS NOT NULL AND signed_xml IS NOT NULL AND submission_payload IS NOT NULL)
  ),
  CHECK (
    state IN ('reserved', 'cancelled_before_dispatch')
    OR (invoice_hash IS NOT NULL AND signed_xml IS NOT NULL AND submission_payload IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS zatca_sandbox_one_open_reservation_per_chain_uidx
  ON public.zatca_sandbox_submission_reservations
  (tenant_id, branch_id, environment, device_id)
  WHERE state IN ('reserved', 'dispatched', 'ambiguous');

ALTER TABLE public.zatca_sandbox_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zatca_sandbox_credentials FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.zatca_sandbox_credentials TO service_role;


ALTER TABLE public.zatca_sandbox_chain_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_sandbox_submission_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zatca_sandbox_chain_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.zatca_sandbox_submission_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zatca_sandbox_chain_state TO service_role;
GRANT ALL ON TABLE public.zatca_sandbox_submission_reservations TO service_role;

-- Validation helpers, provisioning RPCs, and guards are defined only after
-- every Sandbox table, constraint, index, and privilege boundary exists.
CREATE OR REPLACE FUNCTION public.validate_zatca_sandbox_credential_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b JOIN public.tenants t ON t.id=b.tenant_id
    WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id
      AND b.zatca_environment='sandbox' AND t.is_demo IS TRUE
  ) THEN RAISE EXCEPTION 'Sandbox credentials require the demo Sandbox branch' USING ERRCODE='23514'; END IF;
  IF NEW.status = 'active' AND (
    NEW.encrypted_private_key IS NULL
    OR NEW.encrypted_production_csid IS NULL
    OR NEW.encrypted_production_secret IS NULL
    OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NOW())
  ) THEN
    RAISE EXCEPTION 'Active Sandbox credentials are incomplete or expired' USING ERRCODE='23514';
  END IF;
  NEW.updated_at=NOW(); RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_zatca_sandbox_credential_scope ON public.zatca_sandbox_credentials;
CREATE TRIGGER trg_validate_zatca_sandbox_credential_scope
  BEFORE INSERT OR UPDATE ON public.zatca_sandbox_credentials
  FOR EACH ROW EXECUTE FUNCTION public.validate_zatca_sandbox_credential_scope();

CREATE OR REPLACE FUNCTION public.validate_zatca_production_credential_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b JOIN public.tenants t ON t.id=b.tenant_id
    WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id
      AND b.zatca_environment='production' AND t.is_demo IS FALSE
  ) THEN RAISE EXCEPTION 'Production credentials cannot belong to the demo tenant' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_zatca_production_credential_scope ON public.zatca_production_credentials;
CREATE TRIGGER trg_validate_zatca_production_credential_scope
  BEFORE INSERT OR UPDATE ON public.zatca_production_credentials
  FOR EACH ROW EXECUTE FUNCTION public.validate_zatca_production_credential_scope();


CREATE OR REPLACE FUNCTION public.zatca_demo_provisioning_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_is_demo BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_TABLE_NAME = 'tenants'
       AND ((TG_OP = 'INSERT' AND NEW.is_demo IS TRUE)
         OR (TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo)) THEN
      RAISE EXCEPTION 'Demo tenant marker is managed by secure provisioning'
        USING ERRCODE = '42501';
    END IF;

    IF TG_TABLE_NAME = 'branches'
       AND ((TG_OP = 'INSERT' AND NEW.zatca_environment <> 'production')
         OR (TG_OP = 'UPDATE' AND NEW.zatca_environment IS DISTINCT FROM OLD.zatca_environment)) THEN
      RAISE EXCEPTION 'Branch ZATCA environment is managed by secure provisioning'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'branches' THEN
    SELECT t.is_demo INTO v_is_demo
    FROM public.tenants t
    WHERE t.id = NEW.tenant_id;

    IF (v_is_demo IS TRUE AND NEW.zatca_environment <> 'sandbox')
       OR (v_is_demo IS NOT TRUE AND NEW.zatca_environment <> 'production') THEN
      RAISE EXCEPTION 'Demo branches require sandbox and ordinary branches require production'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_zatca_demo_provisioning_guard ON public.tenants;
CREATE TRIGGER trg_tenants_zatca_demo_provisioning_guard
  BEFORE INSERT OR UPDATE OF is_demo ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.zatca_demo_provisioning_guard();

DROP TRIGGER IF EXISTS trg_branches_zatca_environment_provisioning_guard ON public.branches;
CREATE TRIGGER trg_branches_zatca_environment_provisioning_guard
  BEFORE INSERT OR UPDATE OF zatca_environment ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.zatca_demo_provisioning_guard();

CREATE OR REPLACE FUNCTION public.mark_demo_tenant_secure(
  p_tenant_id UUID,
  p_is_demo BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR p_is_demo IS NULL THEN
    RAISE EXCEPTION 'Tenant and demo marker are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found' USING ERRCODE = '22023';
  END IF;

  IF p_is_demo AND EXISTS (
    SELECT 1 FROM public.tenants WHERE is_demo IS TRUE AND id <> p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Only one permanent demo tenant is permitted' USING ERRCODE = '23505';
  END IF;

  IF p_is_demo AND EXISTS (
    SELECT 1 FROM public.zatca_production_credentials
    WHERE tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Remove production credential records before marking a tenant as demo'
      USING ERRCODE = '23514';
  END IF;

  IF p_is_demo AND EXISTS (
    SELECT 1 FROM public.branches WHERE tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'A tenant must have zero branches before it can be marked as the permanent demo tenant'
      USING ERRCODE = '23514';
  END IF;

  IF NOT p_is_demo AND (
    EXISTS (SELECT 1 FROM public.branches WHERE tenant_id=p_tenant_id AND zatca_environment='sandbox')
    OR EXISTS (SELECT 1 FROM public.zatca_sandbox_credentials WHERE tenant_id=p_tenant_id)
    OR EXISTS (SELECT 1 FROM public.zatca_sandbox_chain_state WHERE tenant_id=p_tenant_id)
    OR EXISTS (SELECT 1 FROM public.zatca_sandbox_submission_reservations WHERE tenant_id=p_tenant_id)
    OR EXISTS (
      SELECT 1 FROM public.invoices i
      JOIN public.branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
      WHERE i.tenant_id = p_tenant_id
        AND b.zatca_environment = 'sandbox'
        AND i.zatca_status::text IN ('reported', 'cleared')
    )
  ) THEN
    RAISE EXCEPTION 'Remove Sandbox branches, credentials, chain state, and reservations first' USING ERRCODE='23514';
  END IF;

  UPDATE public.tenants
  SET is_demo = p_is_demo,
      updated_at = NOW()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  RETURN jsonb_build_object('ok', TRUE, 'tenant_id', v_tenant.id, 'is_demo', v_tenant.is_demo);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_branch_zatca_environment_secure(
  p_branch_id UUID,
  p_environment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_branch public.branches%ROWTYPE;
  v_is_demo BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_environment NOT IN ('production', 'sandbox') THEN
    RAISE EXCEPTION 'Invalid ZATCA environment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = '22023';
  END IF;

  SELECT is_demo INTO v_is_demo FROM public.tenants WHERE id = v_branch.tenant_id;

  IF (p_environment = 'sandbox' AND v_is_demo IS NOT TRUE)
     OR (p_environment = 'production' AND v_is_demo IS TRUE) THEN
    RAISE EXCEPTION 'Demo branches require sandbox and ordinary branches require production'
      USING ERRCODE = '42501';
  END IF;

  IF p_environment = 'sandbox' AND EXISTS (
    SELECT 1 FROM public.zatca_production_credentials
    WHERE tenant_id = v_branch.tenant_id AND branch_id = p_branch_id
      AND onboarding_status = 'production_connected'
  ) THEN
    RAISE EXCEPTION 'Disconnect production credentials before selecting sandbox'
      USING ERRCODE = '23514';
  END IF;

  IF p_environment = 'production' AND EXISTS (
    SELECT 1 FROM public.zatca_sandbox_credentials
    WHERE tenant_id = v_branch.tenant_id AND branch_id = p_branch_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Revoke sandbox credentials before selecting production'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.zatca_sandbox_chain_state s
    WHERE s.branch_id = p_branch_id
  ) OR EXISTS (
    SELECT 1 FROM public.zatca_sandbox_submission_reservations r
    WHERE r.branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Cannot change environment after the ZATCA invoice chain has started'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.branches
  SET zatca_environment = p_environment,
      updated_at = NOW()
  WHERE id = p_branch_id
  RETURNING * INTO v_branch;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'tenant_id', v_branch.tenant_id,
    'branch_id', v_branch.id,
    'zatca_environment', v_branch.zatca_environment
  );
END;
$$;



CREATE OR REPLACE FUNCTION public.assert_zatca_sandbox_demo_scope(
  p_tenant_id UUID, p_branch_id UUID, p_device_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET row_security = off
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    JOIN public.branches b ON b.tenant_id = t.id
    JOIN public.zatca_sandbox_credentials c
      ON c.tenant_id = t.id AND c.branch_id = b.id
    WHERE t.id = p_tenant_id AND t.is_demo IS TRUE AND t.is_active IS TRUE
      AND b.id = p_branch_id AND b.is_active IS TRUE AND b.zatca_environment = 'sandbox'
      AND c.environment = 'sandbox' AND c.device_id = p_device_id AND c.status = 'active'
      AND c.encrypted_private_key IS NOT NULL
      AND c.encrypted_production_csid IS NOT NULL
      AND c.encrypted_production_secret IS NOT NULL
      AND (c.expires_at IS NULL OR c.expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'Invalid active Sandbox demo scope' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_zatca_sandbox_submission(
  p_tenant_id UUID, p_branch_id UUID, p_device_id UUID, p_invoice_id UUID
)
RETURNS TABLE (
  reservation_id UUID, invoice_counter BIGINT, previous_invoice_hash TEXT,
  invoice_uuid UUID, reservation_state TEXT, invoice_hash TEXT,
  signed_xml TEXT, submission_payload JSONB, signature_value TEXT, qr_code TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
DECLARE v_invoice RECORD; v_chain RECORD; v_res RECORD;
BEGIN
  PERFORM public.assert_zatca_sandbox_demo_scope(p_tenant_id, p_branch_id, p_device_id);
  SELECT i.id, i.zatca_uuid INTO v_invoice FROM public.invoices i
  WHERE i.id = p_invoice_id AND i.tenant_id = p_tenant_id AND i.branch_id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found in Sandbox demo scope' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_res FROM public.zatca_sandbox_submission_reservations r
  WHERE r.invoice_id = p_invoice_id FOR UPDATE;
  IF FOUND THEN
    IF v_res.tenant_id <> p_tenant_id OR v_res.branch_id <> p_branch_id OR v_res.device_id <> p_device_id THEN
      RAISE EXCEPTION 'Reservation scope mismatch' USING ERRCODE = '42501';
    END IF;
  ELSE
    INSERT INTO public.zatca_sandbox_chain_state (tenant_id, branch_id, environment, device_id)
    VALUES (p_tenant_id, p_branch_id, 'sandbox', p_device_id) ON CONFLICT DO NOTHING;
    SELECT * INTO v_chain FROM public.zatca_sandbox_chain_state
    WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
      AND environment = 'sandbox' AND device_id = p_device_id FOR UPDATE;
    INSERT INTO public.zatca_sandbox_submission_reservations (
      tenant_id, branch_id, environment, device_id, invoice_id, counter, previous_hash, invoice_uuid
    ) VALUES (
      p_tenant_id, p_branch_id, 'sandbox', p_device_id, p_invoice_id,
      v_chain.last_counter + 1, v_chain.previous_hash, v_invoice.zatca_uuid
    ) RETURNING * INTO v_res;
    UPDATE public.zatca_sandbox_chain_state SET last_counter = v_res.counter, updated_at = NOW()
    WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
      AND environment = 'sandbox' AND device_id = p_device_id;
  END IF;
  RETURN QUERY SELECT v_res.id, v_res.counter, v_res.previous_hash, v_res.invoice_uuid,
    v_res.state, v_res.invoice_hash, v_res.signed_xml, v_res.submission_payload,
    v_res.signature_value, v_res.qr_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_zatca_sandbox_signed_payload(
  p_reservation_id UUID, p_tenant_id UUID, p_branch_id UUID, p_device_id UUID,
  p_invoice_id UUID, p_invoice_hash TEXT, p_signed_xml TEXT, p_submission_payload JSONB,
  p_signature_value TEXT, p_qr_code TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
BEGIN
  PERFORM public.assert_zatca_sandbox_demo_scope(p_tenant_id, p_branch_id, p_device_id);
  UPDATE public.zatca_sandbox_submission_reservations SET
    invoice_hash = p_invoice_hash, signed_xml = p_signed_xml, submission_payload = p_submission_payload,
    signature_value = p_signature_value, qr_code = p_qr_code, signed_at = NOW(), updated_at = NOW()
  WHERE id = p_reservation_id AND tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND device_id = p_device_id AND invoice_id = p_invoice_id AND state = 'reserved'
    AND invoice_hash IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signed payload cannot be changed' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_zatca_sandbox_dispatched(
  p_reservation_id UUID, p_tenant_id UUID, p_branch_id UUID, p_device_id UUID, p_invoice_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
BEGIN
  PERFORM public.assert_zatca_sandbox_demo_scope(p_tenant_id, p_branch_id, p_device_id);
  UPDATE public.zatca_sandbox_submission_reservations SET
    state = 'dispatched', dispatched_at = COALESCE(dispatched_at, NOW()), updated_at = NOW()
  WHERE id = p_reservation_id AND tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND device_id = p_device_id AND invoice_id = p_invoice_id
    AND state IN ('reserved', 'ambiguous') AND submission_payload IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation cannot be dispatched' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_zatca_sandbox_ambiguous(
  p_reservation_id UUID, p_tenant_id UUID, p_branch_id UUID, p_device_id UUID,
  p_invoice_id UUID, p_reason TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
BEGIN
  PERFORM public.assert_zatca_sandbox_demo_scope(p_tenant_id, p_branch_id, p_device_id);
  UPDATE public.zatca_sandbox_submission_reservations SET
    state = 'ambiguous', failure_reason = left(p_reason, 1000), updated_at = NOW()
  WHERE id = p_reservation_id AND tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND device_id = p_device_id AND invoice_id = p_invoice_id AND state IN ('dispatched', 'ambiguous');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only dispatched reservations may become ambiguous' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_zatca_sandbox_submission(
  p_reservation_id UUID,
  p_tenant_id UUID,
  p_branch_id UUID,
  p_environment TEXT,
  p_device_id UUID,
  p_invoice_id UUID,
  p_counter BIGINT,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_res RECORD;
  v_next_state TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_environment <> 'sandbox' THEN
    RAISE EXCEPTION 'Reconciliation is Sandbox-only' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_zatca_sandbox_demo_scope(p_tenant_id, p_branch_id, p_device_id);

  SELECT * INTO v_res
  FROM public.zatca_sandbox_submission_reservations
  WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = p_environment
    AND device_id = p_device_id
    AND invoice_id = p_invoice_id
    AND counter = p_counter
  FOR UPDATE;

  IF NOT FOUND OR v_res.invoice_hash IS NULL OR v_res.signed_xml IS NULL
     OR v_res.submission_payload IS NULL THEN
    RAISE EXCEPTION 'Complete persisted Sandbox reservation not found' USING ERRCODE = '23514';
  END IF;

  IF p_action = 'mark_ambiguous' AND v_res.state = 'dispatched' THEN
    v_next_state := 'ambiguous';
  ELSIF p_action = 'mark_dispatched' AND v_res.state = 'ambiguous' THEN
    v_next_state := 'dispatched';
  ELSE
    RAISE EXCEPTION 'Invalid Sandbox reconciliation transition' USING ERRCODE = '23514';
  END IF;

  UPDATE public.zatca_sandbox_submission_reservations
  SET state = v_next_state,
      dispatched_at = CASE WHEN v_next_state = 'dispatched' THEN NOW() ELSE dispatched_at END,
      failure_reason = CASE
        WHEN v_next_state = 'ambiguous' THEN 'Internal reconciliation required after uncertain dispatch'
        ELSE failure_reason
      END,
      updated_at = NOW()
  WHERE id = v_res.id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reservation_id', v_res.id,
    'state', v_next_state,
    'counter', v_res.counter,
    'invoice_hash', v_res.invoice_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_zatca_sandbox_submission(
  p_reservation_id UUID, p_tenant_id UUID, p_branch_id UUID, p_device_id UUID,
  p_invoice_id UUID, p_outcome TEXT, p_http_status INTEGER, p_response_body JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
DECLARE
  v_res RECORD;
  v_invoice_id UUID;
  v_status TEXT;
BEGIN
  PERFORM public.assert_zatca_sandbox_demo_scope(p_tenant_id, p_branch_id, p_device_id);
  IF p_outcome NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Invalid definitive Sandbox outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res
  FROM public.zatca_sandbox_submission_reservations
  WHERE id = p_reservation_id
    AND tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
    AND device_id = p_device_id
    AND invoice_id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sandbox reservation not found' USING ERRCODE = '42501';
  END IF;

  IF v_res.state = 'accepted' THEN
    IF p_outcome = 'accepted' AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = p_invoice_id AND i.tenant_id = p_tenant_id AND i.branch_id = p_branch_id
        AND i.zatca_status::text IN ('reported', 'cleared')
        AND i.zatca_counter_number = v_res.counter
        AND i.zatca_xml_hash = v_res.invoice_hash
        AND i.zatca_prev_invoice_hash = v_res.previous_hash
    ) THEN
      RETURN jsonb_build_object('ok', TRUE, 'state', 'accepted', 'invoice_status', 'reported', 'idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'Accepted reservation does not match the persisted invoice' USING ERRCODE = '23514';
  END IF;

  IF v_res.state = 'rejected' THEN
    IF p_outcome = 'rejected' AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = p_invoice_id AND i.tenant_id = p_tenant_id AND i.branch_id = p_branch_id
        AND i.zatca_status::text = 'failed'
        AND i.zatca_counter_number = v_res.counter
        AND i.zatca_prev_invoice_hash = v_res.previous_hash
    ) THEN
      RETURN jsonb_build_object('ok', TRUE, 'state', 'rejected', 'invoice_status', 'failed', 'idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'Rejected reservation does not match the persisted invoice' USING ERRCODE = '23514';
  END IF;

  IF v_res.state NOT IN ('dispatched', 'ambiguous') THEN
    RAISE EXCEPTION 'Reservation has no dispatch to finalize' USING ERRCODE = '23514';
  END IF;

  IF p_outcome = 'accepted' THEN
    v_status := 'reported';
    UPDATE public.invoices i SET
      zatca_status = 'reported',
      zatca_xml = v_res.signed_xml,
      zatca_xml_hash = v_res.invoice_hash,
      zatca_signature = v_res.signature_value,
      zatca_qr_code = v_res.qr_code,
      zatca_prev_invoice_hash = v_res.previous_hash,
      zatca_counter_number = v_res.counter,
      zatca_submitted_at = NOW(),
      zatca_reporting_response = p_response_body
    WHERE i.id = p_invoice_id
      AND i.tenant_id = p_tenant_id
      AND i.branch_id = p_branch_id
      AND i.zatca_status::text NOT IN ('reported', 'cleared')
    RETURNING i.id INTO v_invoice_id;

    IF v_invoice_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = p_invoice_id AND i.tenant_id = p_tenant_id AND i.branch_id = p_branch_id
        AND i.zatca_status::text IN ('reported', 'cleared')
        AND i.zatca_counter_number = v_res.counter
        AND i.zatca_xml_hash = v_res.invoice_hash
        AND i.zatca_prev_invoice_hash = v_res.previous_hash
    ) THEN
      RAISE EXCEPTION 'Accepted Sandbox result could not be persisted to the exact invoice' USING ERRCODE = '23514';
    END IF;

    UPDATE public.zatca_sandbox_chain_state c
    SET previous_hash = v_res.invoice_hash, updated_at = NOW()
    WHERE c.tenant_id = p_tenant_id
      AND c.branch_id = p_branch_id
      AND c.environment = 'sandbox'
      AND c.device_id = p_device_id
      AND c.last_counter = v_res.counter
      AND c.previous_hash = v_res.previous_hash;

    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM public.zatca_sandbox_chain_state c
      WHERE c.tenant_id = p_tenant_id AND c.branch_id = p_branch_id
        AND c.environment = 'sandbox' AND c.device_id = p_device_id
        AND c.last_counter = v_res.counter AND c.previous_hash = v_res.invoice_hash
    ) THEN
      RAISE EXCEPTION 'Sandbox chain state does not match the accepted reservation' USING ERRCODE = '23514';
    END IF;
  ELSE
    v_status := 'failed';
    UPDATE public.invoices i SET
      zatca_status = 'failed',
      zatca_prev_invoice_hash = v_res.previous_hash,
      zatca_counter_number = v_res.counter,
      zatca_submitted_at = NOW(),
      zatca_reporting_response = p_response_body
    WHERE i.id = p_invoice_id
      AND i.tenant_id = p_tenant_id
      AND i.branch_id = p_branch_id
      AND i.zatca_status::text NOT IN ('reported', 'cleared')
    RETURNING i.id INTO v_invoice_id;

    IF v_invoice_id IS NULL THEN
      RAISE EXCEPTION 'Rejected Sandbox result could not be persisted without downgrading a terminal invoice'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.zatca_sandbox_submission_reservations
  SET state = p_outcome,
      response_status = p_http_status,
      response_body = p_response_body,
      finalized_at = NOW(),
      updated_at = NOW()
  WHERE id = v_res.id
    AND tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
    AND device_id = p_device_id
    AND invoice_id = p_invoice_id
    AND counter = v_res.counter
    AND state IN ('dispatched', 'ambiguous');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sandbox reservation final state could not be persisted' USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'state', p_outcome, 'invoice_status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_zatca_sandbox_before_dispatch(
  p_reservation_id UUID, p_tenant_id UUID, p_branch_id UUID, p_device_id UUID,
  p_invoice_id UUID, p_reason TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
BEGIN
  PERFORM public.assert_zatca_sandbox_demo_scope(p_tenant_id, p_branch_id, p_device_id);
  UPDATE public.zatca_sandbox_submission_reservations SET state = 'cancelled_before_dispatch',
    failure_reason = left(p_reason, 1000), finalized_at = NOW(), updated_at = NOW()
  WHERE id = p_reservation_id AND tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND device_id = p_device_id AND invoice_id = p_invoice_id
    AND state = 'reserved' AND dispatched_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only never-dispatched reservations may be cancelled' USING ERRCODE = '23514'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.zatca_demo_provisioning_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_zatca_encrypted_envelope(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_demo_tenant_secure(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_branch_zatca_environment_secure(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_zatca_sandbox_credential_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_zatca_production_credential_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_zatca_sandbox_demo_scope(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_zatca_sandbox_submission(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_zatca_sandbox_signed_payload(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_zatca_sandbox_dispatched(UUID, UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_zatca_sandbox_ambiguous(UUID, UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_zatca_sandbox_submission(UUID, UUID, UUID, TEXT, UUID, UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_zatca_sandbox_submission(UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_zatca_sandbox_before_dispatch(UUID, UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_demo_tenant_secure(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_zatca_encrypted_envelope(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_branch_zatca_environment_secure(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_zatca_sandbox_submission(UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_zatca_sandbox_signed_payload(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_zatca_sandbox_dispatched(UUID, UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_zatca_sandbox_ambiguous(UUID, UUID, UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_zatca_sandbox_submission(UUID, UUID, UUID, TEXT, UUID, UUID, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_zatca_sandbox_submission(UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_zatca_sandbox_before_dispatch(UUID, UUID, UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
