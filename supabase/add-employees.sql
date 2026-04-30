-- ============================================================
-- Employees Table
-- Safe to run multiple times (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id    UUID REFERENCES branches(id) ON DELETE SET NULL,
  full_name    TEXT NOT NULL,
  full_name_ar TEXT,
  role         TEXT,
  phone        TEXT,
  email        TEXT,
  hire_date    DATE,
  salary       DECIMAL(10, 2),
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees (branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees (tenant_id, is_active);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_employees_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees;
CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_employees_updated_at();

-- RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Super admin: full access
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'employees_super_admin') THEN
    CREATE POLICY "employees_super_admin" ON employees
      FOR ALL TO authenticated
      USING  (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
  END IF;

  -- Owner: full access to their tenant
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'employees_owner_all') THEN
    CREATE POLICY "employees_owner_all" ON employees
      FOR ALL TO authenticated
      USING  (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
  END IF;

  -- Manager: read + write within their tenant
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'employees_manager_all') THEN
    CREATE POLICY "employees_manager_all" ON employees
      FOR ALL TO authenticated
      USING  (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
  END IF;

  -- Accountant / cashier: read only
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'employees_staff_read') THEN
    CREATE POLICY "employees_staff_read" ON employees
      FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
  END IF;
END $$;
