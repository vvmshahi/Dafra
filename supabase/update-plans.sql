-- ============================================================
-- FIX 1: Rename plans to Phase 1 / Phase 2, set correct pricing
-- Reuses existing plan IDs so tenant_subscriptions stay valid
-- ============================================================

-- Update the cheapest plan → Phase 1
UPDATE subscription_plans
SET
  name          = 'Phase 1',
  name_ar       = 'المرحلة الأولى',
  description   = 'ZATCA Phase 1 QR Code Invoicing',
  price_monthly = 50,
  price_yearly  = 500,
  max_branches  = 999,
  max_users     = 999,
  max_products  = 999,
  features      = '["pos","invoicing","zatca_phase1","reports","expenses","inventory"]',
  is_active     = true
WHERE id = (
  SELECT id FROM subscription_plans ORDER BY price_monthly ASC LIMIT 1
);

-- Update the second cheapest plan → Phase 2
UPDATE subscription_plans
SET
  name          = 'Phase 2',
  name_ar       = 'المرحلة الثانية',
  description   = 'Full ZATCA Phase 2 Compliance',
  price_monthly = 100,
  price_yearly  = 1000,
  max_branches  = 999,
  max_users     = 999,
  max_products  = 999,
  features      = '["pos","invoicing","zatca_phase1","zatca_phase2","reports","expenses","inventory","api_reporting"]',
  is_active     = true
WHERE id = (
  SELECT id FROM subscription_plans ORDER BY price_monthly ASC LIMIT 1 OFFSET 1
);

-- Deactivate the third plan (Enterprise / any remaining)
UPDATE subscription_plans
SET is_active = false
WHERE id = (
  SELECT id FROM subscription_plans ORDER BY price_monthly ASC LIMIT 1 OFFSET 2
);

-- ============================================================
-- FIX 3 dependency: add per-tenant branch limit column
-- Allows ManageSubscriptionModal to store a client-specific limit
-- Default 999 = unlimited (plans no longer enforce a hard cap)
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_branches INTEGER DEFAULT 999;

-- Backfill existing tenants to 999 (no limit)
UPDATE tenants SET max_branches = 999 WHERE max_branches IS NULL;

-- ============================================================
-- Verify
-- ============================================================

SELECT id, name, price_monthly, price_yearly, max_branches, is_active
FROM subscription_plans
ORDER BY price_monthly;
