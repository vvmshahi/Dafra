-- ============================================================
-- Dafra SaaS Platform — Supabase Database Schema
-- ZATCA Phase 1 & Phase 2 Compliant | Multi-Tenant
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'super_admin',  -- platform owner, sees all tenants
    'owner',        -- business owner, sees their tenant only
    'manager',      -- branch manager, sees their branch only
    'cashier',      -- POS access only
    'accountant'    -- read-only reports and invoices
);

CREATE TYPE invoice_type AS ENUM (
    'standard',     -- B2B (requires buyer VAT, ZATCA clearance)
    'simplified',   -- B2C (ZATCA reporting within 24h)
    'credit_note',  -- return / correction
    'debit_note'    -- additional charge
);

CREATE TYPE invoice_status AS ENUM (
    'draft',
    'posted',
    'cancelled'
);

CREATE TYPE zatca_status AS ENUM (
    'not_submitted',
    'pending',
    'reported',     -- simplified invoice successfully reported
    'cleared',      -- standard invoice successfully cleared
    'failed'
);

CREATE TYPE payment_method AS ENUM (
    'cash',
    'card',
    'bank_transfer',
    'other'
);

CREATE TYPE payment_status AS ENUM (
    'pending',
    'paid',
    'partial',
    'refunded'
);

CREATE TYPE subscription_status AS ENUM (
    'trial',
    'active',
    'expired',
    'cancelled'
);

CREATE TYPE sync_status AS ENUM (
    'pending',
    'processing',
    'success',
    'failed'
);

CREATE TYPE certificate_status AS ENUM (
    'pending',
    'active',
    'revoked',
    'expired'
);

-- ============================================================
-- SUBSCRIPTION PLANS (platform-level, no tenant_id)
-- ============================================================

CREATE TABLE subscription_plans (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    name_ar         VARCHAR(100),
    description     TEXT,
    description_ar  TEXT,
    price_monthly   NUMERIC(10, 2) NOT NULL DEFAULT 0,
    price_yearly    NUMERIC(10, 2) NOT NULL DEFAULT 0,
    max_branches    INT NOT NULL DEFAULT 1,
    max_users       INT NOT NULL DEFAULT 5,
    max_products    INT NOT NULL DEFAULT 100,   -- -1 = unlimited
    features        JSONB DEFAULT '[]',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TENANTS (one row per business / client)
-- ============================================================

CREATE TABLE tenants (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255) NOT NULL,
    name_ar             VARCHAR(255),
    -- ZATCA mandatory fields
    vat_number          VARCHAR(15) UNIQUE NOT NULL,   -- 15-digit Saudi VAT number
    cr_number           VARCHAR(20),                   -- Commercial Registration number
    -- Contact
    email               VARCHAR(255),
    phone               VARCHAR(20),
    -- Address (ZATCA requires structured address)
    address             TEXT,
    address_ar          TEXT,
    building_number     VARCHAR(10),
    additional_number   VARCHAR(10),
    street              VARCHAR(255),
    street_ar           VARCHAR(255),
    district            VARCHAR(100),
    district_ar         VARCHAR(100),
    city                VARCHAR(100),
    city_ar             VARCHAR(100),
    country             CHAR(2) DEFAULT 'SA',
    postal_code         VARCHAR(10),
    -- Branding
    logo_url            TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TENANT SUBSCRIPTIONS
-- ============================================================

CREATE TABLE tenant_subscriptions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id                 UUID NOT NULL REFERENCES subscription_plans(id),
    status                  subscription_status DEFAULT 'trial',
    starts_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at                 TIMESTAMPTZ,
    trial_ends_at           TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,
    moyasar_subscription_id VARCHAR(255),   -- Moyasar payment reference (later phase)
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BRANCHES (one tenant can have up to plan.max_branches)
-- ============================================================

CREATE TABLE branches (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    name_ar             VARCHAR(255),
    branch_code         VARCHAR(50),
    phone               VARCHAR(20),
    email               VARCHAR(255),
    -- Address
    address             TEXT,
    address_ar          TEXT,
    building_number     VARCHAR(10),
    additional_number   VARCHAR(10),
    street              VARCHAR(255),
    street_ar           VARCHAR(255),
    district            VARCHAR(100),
    district_ar         VARCHAR(100),
    city                VARCHAR(100),
    city_ar             VARCHAR(100),
    country             CHAR(2) DEFAULT 'SA',
    postal_code         VARCHAR(10),
    is_main_branch      BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    -- Thread-safe invoice counter (incremented atomically per invoice)
    invoice_counter     BIGINT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, branch_code)
);

-- ============================================================
-- USER PROFILES (extends Supabase auth.users)
-- ============================================================

CREATE TABLE user_profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
    role        user_role NOT NULL DEFAULT 'cashier',
    full_name   VARCHAR(255),
    full_name_ar VARCHAR(255),
    phone       VARCHAR(20),
    avatar_url  TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ZATCA CERTIFICATES (one per branch per environment)
-- Each branch registers its own CSID with ZATCA.
-- ============================================================

CREATE TABLE zatca_certificates (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id               UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    -- CSR / Certificate
    csr                     TEXT,                   -- PEM Certificate Signing Request
    certificate             TEXT,                   -- CSID certificate returned by ZATCA
    private_key_encrypted   TEXT,                   -- AES-encrypted ECDSA P-256 private key
    -- Compliance (sandbox onboarding)
    otp                     VARCHAR(6),             -- one-time password for ZATCA onboarding
    compliance_request_id   VARCHAR(255),
    compliance_csid         VARCHAR(512),
    -- Production
    production_request_id   VARCHAR(255),
    production_csid         VARCHAR(512),
    -- Metadata
    status                  certificate_status DEFAULT 'pending',
    environment             VARCHAR(20) DEFAULT 'sandbox',  -- 'sandbox' | 'production'
    serial_number           VARCHAR(255),
    valid_from              TIMESTAMPTZ,
    valid_to                TIMESTAMPTZ,
    -- Invoice chaining (ZATCA requires hash of last submitted invoice)
    last_invoice_hash       TEXT,
    invoice_counter         BIGINT DEFAULT 0,       -- ZATCA sequential counter
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (branch_id, environment)
);

-- ============================================================
-- CATEGORIES (product hierarchy)
-- ============================================================

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
    name        VARCHAR(255) NOT NULL,
    name_ar     VARCHAR(255),
    description TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PRODUCTS (inventory items and services)
-- ============================================================

CREATE TABLE products (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    name                VARCHAR(255) NOT NULL,
    name_ar             VARCHAR(255),
    description         TEXT,
    description_ar      TEXT,
    sku                 VARCHAR(100),
    barcode             VARCHAR(100),
    unit                VARCHAR(50) DEFAULT 'piece',  -- piece | kg | liter | hour …
    unit_ar             VARCHAR(50),
    price               NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cost                NUMERIC(12, 2) DEFAULT 0,
    tax_rate            NUMERIC(5, 2) DEFAULT 15.00,  -- Saudi standard VAT = 15%
    tax_category        VARCHAR(10) DEFAULT 'S',      -- S=Standard Z=Zero E=Exempt O=OOS
    is_taxable          BOOLEAN DEFAULT TRUE,
    stock_quantity      NUMERIC(12, 3) DEFAULT 0,
    min_stock_alert     NUMERIC(12, 3) DEFAULT 0,
    image_url           TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    is_service          BOOLEAN DEFAULT FALSE,         -- TRUE = service, no stock tracking
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, sku)
);

-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    name_ar         VARCHAR(255),
    customer_type   VARCHAR(20) DEFAULT 'individual',  -- 'individual' | 'business'
    -- Required for B2B (standard) ZATCA invoices
    vat_number      VARCHAR(15),
    cr_number       VARCHAR(20),
    -- Contact
    email           VARCHAR(255),
    phone           VARCHAR(20),
    -- Address
    address         TEXT,
    address_ar      TEXT,
    building_number VARCHAR(10),
    additional_number VARCHAR(10),
    district        VARCHAR(100),
    city            VARCHAR(100),
    country         CHAR(2) DEFAULT 'SA',
    postal_code     VARCHAR(10),
    notes           TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EMPLOYEES
-- ============================================================

CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id       UUID REFERENCES branches(id) ON DELETE SET NULL,
    user_id         UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    full_name       VARCHAR(255) NOT NULL,
    full_name_ar    VARCHAR(255),
    national_id     VARCHAR(20),        -- Saudi national ID
    iqama_number    VARCHAR(20),        -- residence permit (expats)
    email           VARCHAR(255),
    phone           VARCHAR(20),
    position        VARCHAR(100),
    position_ar     VARCHAR(100),
    department      VARCHAR(100),
    department_ar   VARCHAR(100),
    salary          NUMERIC(12, 2),
    hire_date       DATE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INVOICES (ZATCA Phase 1 & Phase 2 compliant)
-- ============================================================

CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id       UUID NOT NULL REFERENCES branches(id),
    customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
    created_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,

    -- Human-readable invoice number (e.g. INV-2024-00001)
    invoice_number  VARCHAR(50) NOT NULL,
    -- Reference to original invoice for credit/debit notes
    invoice_reference VARCHAR(100),

    -- ── ZATCA mandatory fields ──────────────────────────────
    -- Universally unique identifier (must never change after creation)
    zatca_uuid              UUID NOT NULL DEFAULT uuid_generate_v4(),
    zatca_invoice_type      invoice_type NOT NULL DEFAULT 'simplified',
    -- ZATCA invoice type transaction code (e.g. 388=standard, 381=credit, 383=debit)
    zatca_type_code         VARCHAR(10) DEFAULT '388',
    -- Sequential counter per branch certificate (increments atomically)
    zatca_counter_number    BIGINT,
    -- SHA-256 hash of the previous invoice XML (chain integrity)
    zatca_prev_invoice_hash TEXT,
    -- Signed UBL 2.1 XML (stored for audit, 6-year ZATCA requirement)
    zatca_xml               TEXT,
    -- SHA-256 hash of zatca_xml (used in QR and chaining)
    zatca_xml_hash          TEXT,
    -- ECDSA P-256 digital signature (base64-encoded)
    zatca_signature         TEXT,
    -- TLV Base64 QR code (5 fields Phase 1, extended Phase 2)
    zatca_qr_code           TEXT,
    -- Submission tracking
    zatca_status            zatca_status DEFAULT 'not_submitted',
    zatca_submission_id     VARCHAR(255),
    zatca_submitted_at      TIMESTAMPTZ,
    -- Clearance / reporting responses from ZATCA API
    zatca_clearance_status  VARCHAR(50),
    zatca_clearance_response JSONB,
    zatca_reporting_response JSONB,
    zatca_warnings          JSONB,
    -- ── End ZATCA fields ────────────────────────────────────

    -- Amounts (all in SAR)
    subtotal        NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- before discount & tax
    discount_amount NUMERIC(12, 2) DEFAULT 0,
    taxable_amount  NUMERIC(12, 2) DEFAULT 0,           -- subtotal - discount
    tax_amount      NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- taxable_amount + tax_amount
    currency_code   CHAR(3) DEFAULT 'SAR',

    -- Dates
    invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    supply_date     DATE,       -- actual date goods/services delivered (can differ)
    due_date        DATE,

    -- Status
    status          invoice_status DEFAULT 'draft',
    payment_status  payment_status DEFAULT 'pending',

    -- Notes
    notes           TEXT,
    notes_ar        TEXT,

    -- Cancellation
    cancelled_at            TIMESTAMPTZ,
    cancellation_reason     TEXT,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (tenant_id, invoice_number),
    UNIQUE (zatca_uuid)
);

-- ============================================================
-- INVOICE ITEMS
-- ============================================================

CREATE TABLE invoice_items (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id  UUID REFERENCES products(id) ON DELETE SET NULL,

    -- Snapshot of product data at time of invoice (immutable record)
    name            VARCHAR(255) NOT NULL,
    name_ar         VARCHAR(255),
    description     TEXT,
    sku             VARCHAR(100),
    unit            VARCHAR(50),

    -- Pricing
    quantity        NUMERIC(12, 3) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(12, 2) NOT NULL,
    discount_percent NUMERIC(5, 2) DEFAULT 0,
    discount_amount NUMERIC(12, 2) DEFAULT 0,
    subtotal        NUMERIC(12, 2) NOT NULL,  -- quantity * unit_price - discount

    -- Tax (ZATCA requires per-line tax details)
    tax_rate        NUMERIC(5, 2) DEFAULT 15.00,
    tax_category    VARCHAR(10) DEFAULT 'S',  -- S | Z | E | O
    tax_amount      NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total           NUMERIC(12, 2) NOT NULL,  -- subtotal + tax_amount

    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE payments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    recorded_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    amount      NUMERIC(12, 2) NOT NULL,
    method      payment_method NOT NULL DEFAULT 'cash',
    reference   VARCHAR(255),   -- transaction ID / cheque number / transfer ref
    notes       TEXT,
    paid_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SYNC QUEUE (offline-first: queue ZATCA submissions from POS)
-- ============================================================

CREATE TABLE sync_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    invoice_id      UUID REFERENCES invoices(id) ON DELETE CASCADE,
    action          VARCHAR(50) NOT NULL,    -- 'report' | 'clear' | 'retry'
    payload         JSONB,
    status          sync_status DEFAULT 'pending',
    attempts        INT DEFAULT 0,
    max_attempts    INT DEFAULT 3,
    last_attempt_at TIMESTAMPTZ,
    last_error      TEXT,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- tenants
CREATE INDEX idx_tenants_vat        ON tenants (vat_number);

-- tenant_subscriptions
CREATE INDEX idx_tenant_subs_tenant ON tenant_subscriptions (tenant_id);
CREATE INDEX idx_tenant_subs_status ON tenant_subscriptions (status);

-- branches
CREATE INDEX idx_branches_tenant    ON branches (tenant_id);

-- user_profiles
CREATE INDEX idx_user_profiles_tenant ON user_profiles (tenant_id);
CREATE INDEX idx_user_profiles_branch ON user_profiles (branch_id);
CREATE INDEX idx_user_profiles_role   ON user_profiles (role);

-- zatca_certificates
CREATE INDEX idx_zatca_certs_tenant ON zatca_certificates (tenant_id);
CREATE INDEX idx_zatca_certs_branch ON zatca_certificates (branch_id);

-- categories
CREATE INDEX idx_categories_tenant  ON categories (tenant_id);
CREATE INDEX idx_categories_parent  ON categories (parent_id);

-- products
CREATE INDEX idx_products_tenant    ON products (tenant_id);
CREATE INDEX idx_products_category  ON products (category_id);
CREATE INDEX idx_products_barcode   ON products (barcode);

-- customers
CREATE INDEX idx_customers_tenant   ON customers (tenant_id);
CREATE INDEX idx_customers_vat      ON customers (vat_number) WHERE vat_number IS NOT NULL;

-- employees
CREATE INDEX idx_employees_tenant   ON employees (tenant_id);
CREATE INDEX idx_employees_branch   ON employees (branch_id);

-- invoices
CREATE INDEX idx_invoices_tenant        ON invoices (tenant_id);
CREATE INDEX idx_invoices_branch        ON invoices (branch_id);
CREATE INDEX idx_invoices_customer      ON invoices (customer_id);
CREATE INDEX idx_invoices_date          ON invoices (invoice_date);
CREATE INDEX idx_invoices_status        ON invoices (status);
CREATE INDEX idx_invoices_zatca_status  ON invoices (zatca_status);
CREATE INDEX idx_invoices_zatca_uuid    ON invoices (zatca_uuid);
CREATE INDEX idx_invoices_number        ON invoices (tenant_id, invoice_number);
CREATE INDEX idx_invoices_created_by    ON invoices (created_by);

-- invoice_items
CREATE INDEX idx_invoice_items_invoice  ON invoice_items (invoice_id);
CREATE INDEX idx_invoice_items_product  ON invoice_items (product_id);
CREATE INDEX idx_invoice_items_tenant   ON invoice_items (tenant_id);

-- payments
CREATE INDEX idx_payments_tenant    ON payments (tenant_id);
CREATE INDEX idx_payments_invoice   ON payments (invoice_id);

-- sync_queue
CREATE INDEX idx_sync_queue_tenant  ON sync_queue (tenant_id);
CREATE INDEX idx_sync_queue_status  ON sync_queue (status);
CREATE INDEX idx_sync_queue_invoice ON sync_queue (invoice_id);

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscription_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tenant_subs_updated_at
    BEFORE UPDATE ON tenant_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_branches_updated_at
    BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_zatca_certs_updated_at
    BEFORE UPDATE ON zatca_certificates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sync_queue_updated_at
    BEFORE UPDATE ON sync_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- HELPER FUNCTIONS FOR RLS (SECURITY DEFINER — bypass RLS internally)
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS UUID AS $$
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_my_branch_id()
RETURNS UUID AS $$
    SELECT branch_id FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
    SELECT role FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND role = 'super_admin'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE subscription_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE zatca_certificates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories              ENABLE ROW LEVEL SECURITY;
ALTER TABLE products                ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees               ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue              ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES: subscription_plans
-- ============================================================

CREATE POLICY "plans_read_active"   ON subscription_plans
    FOR SELECT USING (is_active = TRUE OR is_super_admin());

CREATE POLICY "plans_super_admin"   ON subscription_plans
    FOR ALL    USING (is_super_admin());

-- ============================================================
-- RLS POLICIES: tenants
-- ============================================================

CREATE POLICY "tenants_super_admin" ON tenants
    FOR ALL    USING (is_super_admin());

CREATE POLICY "tenants_own_read"    ON tenants
    FOR SELECT USING (id = get_my_tenant_id());

CREATE POLICY "tenants_owner_update" ON tenants
    FOR UPDATE USING (id = get_my_tenant_id() AND get_my_role() = 'owner');

-- ============================================================
-- RLS POLICIES: tenant_subscriptions
-- ============================================================

CREATE POLICY "tenant_subs_super_admin" ON tenant_subscriptions
    FOR ALL    USING (is_super_admin());

CREATE POLICY "tenant_subs_read"    ON tenant_subscriptions
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'accountant')
    );

-- ============================================================
-- RLS POLICIES: branches
-- ============================================================

CREATE POLICY "branches_super_admin" ON branches
    FOR ALL    USING (is_super_admin());

CREATE POLICY "branches_owner_all"  ON branches
    FOR ALL    USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "branches_staff_read" ON branches
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('manager', 'cashier', 'accountant')
        AND (
            get_my_role() = 'accountant'        -- accountant sees all branches
            OR id = get_my_branch_id()          -- others see only their branch
        )
    );

-- ============================================================
-- RLS POLICIES: user_profiles
-- ============================================================
--
-- IMPORTANT: Do NOT use is_super_admin() / get_my_role() inside
-- FOR ALL policies here. Those helpers query user_profiles, and
-- a FOR ALL policy propagates its USING clause as WITH CHECK on
-- INSERT/UPDATE — creating an indirect recursion path that GoTrue
-- surfaces as "Database error querying schema".
--
-- Pattern used instead:
--   • SELECT policies   → safe to call helpers (read-only, no recursion risk)
--   • INSERT/UPDATE/DELETE → scoped to id = auth.uid() only; admin writes
--                            are done through service-role Edge Functions
-- ──────────────────────────────────────────────────────────────

-- Every authenticated user can read their own profile.
-- Scoped to `authenticated` so the anon role never hits it.
CREATE POLICY "user_profiles_own_read"      ON user_profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

-- Every authenticated user can update their own profile (name, avatar, phone).
CREATE POLICY "user_profiles_own_update"    ON user_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid());

-- Super admin can read any profile.
-- FOR SELECT only → no WITH CHECK propagation, no INSERT recursion.
CREATE POLICY "user_profiles_super_admin_read" ON user_profiles
    FOR SELECT TO authenticated
    USING (is_super_admin());

-- Owner can read all profiles within their tenant.
CREATE POLICY "user_profiles_owner_read"    ON user_profiles
    FOR SELECT TO authenticated
    USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

-- Manager can read profiles scoped to their branch.
CREATE POLICY "user_profiles_manager_read"  ON user_profiles
    FOR SELECT TO authenticated
    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'manager'
        AND branch_id = get_my_branch_id()
    );

-- ============================================================
-- RLS POLICIES: zatca_certificates
-- ============================================================

CREATE POLICY "zatca_certs_super_admin"     ON zatca_certificates
    FOR ALL    USING (is_super_admin());

CREATE POLICY "zatca_certs_owner_all"       ON zatca_certificates
    FOR ALL    USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "zatca_certs_manager_read"    ON zatca_certificates
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'manager'
        AND branch_id = get_my_branch_id()
    );

-- ============================================================
-- RLS POLICIES: categories
-- ============================================================

CREATE POLICY "categories_super_admin"      ON categories
    FOR ALL    USING (is_super_admin());

CREATE POLICY "categories_tenant_read"      ON categories
    FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "categories_owner_mgr_write"  ON categories
    FOR ALL    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- RLS POLICIES: products
-- ============================================================

CREATE POLICY "products_super_admin"        ON products
    FOR ALL    USING (is_super_admin());

CREATE POLICY "products_tenant_read"        ON products
    FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "products_owner_mgr_write"    ON products
    FOR ALL    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- RLS POLICIES: customers
-- ============================================================

CREATE POLICY "customers_super_admin"       ON customers
    FOR ALL    USING (is_super_admin());

CREATE POLICY "customers_tenant_read"       ON customers
    FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "customers_write"             ON customers
    FOR ALL    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
    );

-- ============================================================
-- RLS POLICIES: employees
-- ============================================================

CREATE POLICY "employees_super_admin"       ON employees
    FOR ALL    USING (is_super_admin());

CREATE POLICY "employees_owner_all"         ON employees
    FOR ALL    USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "employees_manager_branch"    ON employees
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'manager'
        AND branch_id = get_my_branch_id()
    );

-- ============================================================
-- RLS POLICIES: invoices
-- ============================================================

CREATE POLICY "invoices_super_admin"        ON invoices
    FOR ALL    USING (is_super_admin());

CREATE POLICY "invoices_owner_all"          ON invoices
    FOR ALL    USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "invoices_manager_branch"     ON invoices
    FOR ALL    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'manager'
        AND branch_id = get_my_branch_id()
    );

CREATE POLICY "invoices_cashier_branch"     ON invoices
    FOR ALL    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'cashier'
        AND branch_id = get_my_branch_id()
    );

CREATE POLICY "invoices_accountant_read"    ON invoices
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'accountant'
    );

-- ============================================================
-- RLS POLICIES: invoice_items
-- ============================================================

CREATE POLICY "invoice_items_super_admin"   ON invoice_items
    FOR ALL    USING (is_super_admin());

-- Access flows through invoices RLS — mirror tenant check here
CREATE POLICY "invoice_items_tenant"        ON invoice_items
    FOR ALL    USING (tenant_id = get_my_tenant_id());

-- ============================================================
-- RLS POLICIES: payments
-- ============================================================

CREATE POLICY "payments_super_admin"        ON payments
    FOR ALL    USING (is_super_admin());

CREATE POLICY "payments_owner_all"          ON payments
    FOR ALL    USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'owner');

CREATE POLICY "payments_manager_cashier"    ON payments
    FOR ALL    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('manager', 'cashier')
        AND EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id = payments.invoice_id
              AND invoices.branch_id = get_my_branch_id()
        )
    );

CREATE POLICY "payments_accountant_read"    ON payments
    FOR SELECT USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'accountant'
    );

-- ============================================================
-- RLS POLICIES: sync_queue
-- ============================================================

CREATE POLICY "sync_queue_super_admin"      ON sync_queue
    FOR ALL    USING (is_super_admin());

CREATE POLICY "sync_queue_tenant"           ON sync_queue
    FOR ALL    USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
    );

-- ============================================================
-- TRIGGER: auto-create user_profile on auth signup
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(
            (NEW.raw_user_meta_data ->> 'role')::user_role,
            'cashier'
        )
    )
    -- Some GoTrue versions UPSERT auth.users during sign-in, which re-fires
    -- this AFTER INSERT trigger. Without ON CONFLICT the duplicate key error
    -- propagates to GoTrue and surfaces as "Database error querying schema".
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- FUNCTION: thread-safe invoice counter per branch
-- Called when creating an invoice to get the next sequential number.
-- ============================================================

CREATE OR REPLACE FUNCTION get_next_invoice_counter(p_branch_id UUID)
RETURNS BIGINT AS $$
DECLARE
    v_counter BIGINT;
BEGIN
    UPDATE branches
    SET    invoice_counter = invoice_counter + 1
    WHERE  id = p_branch_id
    RETURNING invoice_counter INTO v_counter;
    RETURN v_counter;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: thread-safe ZATCA counter per certificate
-- Called when signing/submitting an invoice to ZATCA.
-- ============================================================

CREATE OR REPLACE FUNCTION get_next_zatca_counter(p_branch_id UUID, p_env VARCHAR DEFAULT 'sandbox')
RETURNS BIGINT AS $$
DECLARE
    v_counter BIGINT;
BEGIN
    UPDATE zatca_certificates
    SET    invoice_counter = invoice_counter + 1
    WHERE  branch_id = p_branch_id AND environment = p_env
    RETURNING invoice_counter INTO v_counter;
    RETURN v_counter;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SEED DATA: default subscription plans
-- ============================================================

INSERT INTO subscription_plans
    (name, name_ar, price_monthly, price_yearly, max_branches, max_users, max_products, features)
VALUES
(
    'Starter', 'المبتدئ',
    99, 999,
    1, 3, 100,
    '["pos","invoicing","zatca_phase1"]'
),
(
    'Professional', 'المحترف',
    249, 2499,
    3, 10, 1000,
    '["pos","invoicing","zatca_phase1","zatca_phase2","inventory","employees","reports"]'
),
(
    'Enterprise', 'المؤسسي',
    599, 5999,
    10, 50, -1,
    '["pos","invoicing","zatca_phase1","zatca_phase2","inventory","employees","reports","api_access","custom_branding","priority_support"]'
);
