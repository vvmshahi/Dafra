-- Super-admin tenant management columns
-- Run after schema.sql has been applied.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS suspended_at    timestamptz  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_reason text         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_active_at  timestamptz  DEFAULT NULL;

-- Keep last_active_at updated automatically whenever an invoice is created
CREATE OR REPLACE FUNCTION update_tenant_last_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE tenants
     SET last_active_at = now()
   WHERE id = NEW.tenant_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_last_active ON invoices;
CREATE TRIGGER trg_tenant_last_active
  AFTER INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_tenant_last_active();
