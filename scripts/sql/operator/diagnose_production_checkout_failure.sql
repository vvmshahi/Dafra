-- Read-only production checkout incident diagnostic.
--
-- Optional targeting:
--   Replace the empty values below with the affected UUIDs before execution.
--   Leave them empty to inspect recent suspicious records across production.
--
-- This script intentionally excludes customer data, authorization material,
-- ZATCA XML, QR payloads, certificates, signatures, keys, and raw responses.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '2s';
SET LOCAL app.checkout_diagnostic_branch_id = '';
SET LOCAL app.checkout_diagnostic_user_id = '';
SET LOCAL app.checkout_diagnostic_window = '24 hours';

SELECT
  current_database() AS database_name,
  current_user AS database_user,
  current_setting('transaction_read_only') AS transaction_read_only,
  clock_timestamp() AS observed_at;

-- A. Required checkout functions and their exact execution surface.
WITH expected(signature) AS (
  VALUES
    ('public.pos_checkout(jsonb)'),
    ('public.get_next_invoice_counter(uuid)'),
    ('public.branch_effective_stock_enabled(uuid,uuid)'),
    ('public.get_zatca_finalization_capabilities_v2()'),
    ('public.get_zatca_atomic_checkout_result_v2(uuid,uuid,text,text)')
),
function_state AS (
  SELECT
    expected.signature,
    procedure.oid,
    pg_get_userbyid(procedure.proowner) AS owner,
    procedure.prosecdef AS security_definer,
    procedure.proconfig AS config,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE md5(pg_get_functiondef(procedure.oid))
    END AS definition_md5,
    COALESCE((
      SELECT bool_or(
        privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
      )
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
    ), false) AS public_execute,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE has_function_privilege('anon', procedure.oid, 'EXECUTE')
    END AS anon_execute,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    END AS authenticated_execute,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    END AS service_role_execute
  FROM expected
  LEFT JOIN pg_proc procedure
    ON procedure.oid = to_regprocedure(expected.signature)
)
SELECT
  signature,
  CASE WHEN oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS presence,
  owner,
  security_definer,
  config,
  definition_md5,
  CASE
    WHEN signature = 'public.pos_checkout(jsonb)'
      AND definition_md5 = '0db582cb8451ab6a6a69bb9d9d662de6'
      THEN 'canonical_stock_rule'
    WHEN signature = 'public.pos_checkout(jsonb)'
      AND definition_md5 = '68d6d28ff7ed53ad8b79180b3e26592b'
      THEN 'pre_stock_rule_atomic_aligned'
    WHEN signature = 'public.pos_checkout(jsonb)'
      THEN 'UNREVIEWED_POS_HASH'
    ELSE 'metadata_only'
  END AS reviewed_contract,
  public_execute,
  anon_execute,
  authenticated_execute,
  service_role_execute
FROM function_state
ORDER BY signature;

SELECT
  object_name,
  CASE WHEN relation_oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS presence
FROM (
  VALUES
    ('public.user_profiles', to_regclass('public.user_profiles')),
    ('public.tenants', to_regclass('public.tenants')),
    ('public.branches', to_regclass('public.branches')),
    ('public.products', to_regclass('public.products')),
    ('public.pos_sessions', to_regclass('public.pos_sessions')),
    ('public.invoices', to_regclass('public.invoices')),
    ('public.invoice_items', to_regclass('public.invoice_items')),
    ('public.payments', to_regclass('public.payments')),
    ('public.pos_stock_movements', to_regclass('public.pos_stock_movements')),
    ('public.zatca_finalization_runtime', to_regclass('public.zatca_finalization_runtime')),
    ('public.zatca_atomic_checkout_intents_v2', to_regclass('public.zatca_atomic_checkout_intents_v2')),
    ('public.zatca_reporting_outbox_v2', to_regclass('public.zatca_reporting_outbox_v2'))
) objects(object_name, relation_oid)
ORDER BY object_name;

-- Optional ZATCA runtime state. This remains executable when the v2 runtime
-- table or the later atomic flag column is absent.
DO $diagnostic_runtime$
DECLARE
  v_result jsonb;
  v_atomic_enabled boolean;
BEGIN
  IF to_regclass('public.zatca_finalization_runtime') IS NULL THEN
    v_result := jsonb_build_object(
      'runtime_table_present', false,
      'legacy_submit_available', true,
      'atomic_checkout_compatible', false
    );
  ELSE
    EXECUTE $query$
      SELECT jsonb_build_object(
        'runtime_table_present', true,
        'schema_version', schema_version,
        'minimum_edge_version', minimum_edge_version,
        'minimum_client_version', minimum_client_version,
        'immutable_finalization_enabled', immutable_finalization_enabled,
        'simplified_enabled', simplified_enabled,
        'standard_enabled', standard_enabled
      )
      FROM public.zatca_finalization_runtime
      WHERE singleton = true
    $query$
    INTO v_result;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'zatca_finalization_runtime'
        AND column_name = 'atomic_simplified_checkout_enabled'
    ) THEN
      EXECUTE $query$
        SELECT atomic_simplified_checkout_enabled
        FROM public.zatca_finalization_runtime
        WHERE singleton = true
      $query$
      INTO v_atomic_enabled;
      v_result := COALESCE(v_result, '{}'::jsonb)
        || jsonb_build_object(
          'atomic_simplified_checkout_enabled',
          COALESCE(v_atomic_enabled, false)
        );
    ELSE
      v_result := COALESCE(v_result, '{}'::jsonb)
        || jsonb_build_object(
          'atomic_simplified_checkout_enabled',
          'column_missing'
        );
    END IF;
  END IF;

  RAISE NOTICE 'checkout_diagnostic.zatca_runtime=%', v_result;
END
$diagnostic_runtime$;

-- B. Active user, tenant, branch, subscription, stock, and session scope.
WITH parameters AS (
  SELECT
    NULLIF(current_setting('app.checkout_diagnostic_branch_id'), '')::uuid
      AS branch_id,
    NULLIF(current_setting('app.checkout_diagnostic_user_id'), '')::uuid
      AS user_id
)
SELECT
  profile.id AS user_id,
  profile.role::text AS role,
  profile.is_active AS profile_active,
  profile.tenant_id,
  profile.branch_id,
  tenant.is_active AS tenant_active,
  tenant.suspended_at IS NOT NULL AS tenant_suspended,
  tenant.business_type,
  branch.is_active AS branch_active,
  branch.name AS branch_name,
  branch.stock_enabled,
  (
    COALESCE(tenant.business_type, 'trading') <> 'service'
    AND COALESCE(branch.stock_enabled, true)
  ) AS effective_stock_enabled,
  subscription.status::text AS subscription_status,
  subscription.subscription_lifecycle_status,
  subscription.manual_payment_status
FROM public.user_profiles profile
JOIN public.tenants tenant ON tenant.id = profile.tenant_id
LEFT JOIN public.branches branch ON branch.id = profile.branch_id
LEFT JOIN LATERAL (
  SELECT
    state.status,
    state.subscription_lifecycle_status,
    state.manual_payment_status
  FROM public.tenant_subscriptions state
  WHERE state.tenant_id = profile.tenant_id
  ORDER BY state.updated_at DESC NULLS LAST, state.created_at DESC NULLS LAST
  LIMIT 1
) subscription ON true
CROSS JOIN parameters
WHERE (
    parameters.user_id IS NOT NULL
    AND profile.id = parameters.user_id
  )
  OR (
    parameters.user_id IS NULL
    AND parameters.branch_id IS NOT NULL
    AND profile.branch_id = parameters.branch_id
  )
  OR (
    parameters.user_id IS NULL
    AND parameters.branch_id IS NULL
    AND profile.is_active
  )
ORDER BY profile.updated_at DESC NULLS LAST
LIMIT 30;

WITH parameters AS (
  SELECT NULLIF(
    current_setting('app.checkout_diagnostic_branch_id'),
    ''
  )::uuid AS branch_id
)
SELECT
  branch.id AS branch_id,
  branch.tenant_id,
  branch.name AS branch_name,
  branch.is_active AS branch_active,
  tenant.is_active AS tenant_active,
  tenant.suspended_at IS NOT NULL AS tenant_suspended,
  tenant.business_type,
  branch.stock_enabled,
  (
    COALESCE(tenant.business_type, 'trading') <> 'service'
    AND COALESCE(branch.stock_enabled, true)
  ) AS effective_stock_enabled,
  branch.invoice_counter,
  branch.invoice_prefix,
  branch.vat_mode,
  count(session.id) FILTER (WHERE session.status = 'open') AS open_session_count,
  max(session.opened_at) FILTER (WHERE session.status = 'open')
    AS latest_open_session_at
FROM public.branches branch
JOIN public.tenants tenant ON tenant.id = branch.tenant_id
LEFT JOIN public.pos_sessions session
  ON session.branch_id = branch.id
 AND session.tenant_id = branch.tenant_id
CROSS JOIN parameters
WHERE parameters.branch_id IS NULL OR branch.id = parameters.branch_id
GROUP BY
  branch.id,
  branch.tenant_id,
  branch.name,
  branch.is_active,
  tenant.is_active,
  tenant.suspended_at,
  tenant.business_type,
  branch.stock_enabled,
  branch.invoice_counter,
  branch.invoice_prefix,
  branch.vat_mode
ORDER BY max(branch.updated_at) DESC NULLS LAST
LIMIT 30;

-- C. Product scope and values that can make authoritative checkout fail.
WITH parameters AS (
  SELECT NULLIF(
    current_setting('app.checkout_diagnostic_branch_id'),
    ''
  )::uuid AS branch_id
)
SELECT
  product.branch_id,
  count(*) AS total_products,
  count(*) FILTER (WHERE product.is_active AND product.is_available)
    AS active_available_products,
  count(*) FILTER (
    WHERE product.tenant_id IS DISTINCT FROM branch.tenant_id
  ) AS tenant_scope_mismatch,
  count(*) FILTER (
    WHERE product.price IS NULL OR product.price < 0
  ) AS invalid_price_count,
  count(*) FILTER (
    WHERE product.tax_rate IS NULL
       OR product.tax_rate < 0
       OR product.tax_rate > 100
  ) AS invalid_tax_rate_count,
  count(*) FILTER (
    WHERE product.vat_treatment NOT IN (
      'inherit', 'exclusive', 'inclusive', 'exempt'
    )
  ) AS invalid_vat_treatment_count,
  count(*) FILTER (
    WHERE product.track_stock
      AND NOT product.is_service
      AND product.stock_quantity IS NULL
  ) AS tracked_null_stock_count,
  count(*) FILTER (
    WHERE product.track_stock
      AND NOT product.is_service
      AND product.stock_quantity < 0
  ) AS tracked_negative_stock_count,
  count(*) FILTER (
    WHERE product.track_stock
      AND NOT product.is_service
      AND COALESCE(product.stock_quantity, 0) <= 0
  ) AS tracked_zero_or_negative_stock_count
FROM public.products product
LEFT JOIN public.branches branch ON branch.id = product.branch_id
CROSS JOIN parameters
WHERE parameters.branch_id IS NULL OR product.branch_id = parameters.branch_id
GROUP BY product.branch_id
ORDER BY product.branch_id;

WITH parameters AS (
  SELECT NULLIF(
    current_setting('app.checkout_diagnostic_branch_id'),
    ''
  )::uuid AS branch_id
)
SELECT
  product.id AS product_id,
  product.tenant_id,
  product.branch_id,
  product.sku,
  product.is_active,
  product.is_available,
  product.is_service,
  product.track_stock,
  product.stock_quantity,
  product.price,
  product.tax_rate,
  product.vat_treatment,
  CASE
    WHEN branch.id IS NULL THEN 'missing_branch'
    WHEN product.tenant_id IS DISTINCT FROM branch.tenant_id
      THEN 'tenant_branch_scope_mismatch'
    WHEN product.price IS NULL OR product.price < 0 THEN 'invalid_price'
    WHEN product.tax_rate IS NULL
      OR product.tax_rate < 0
      OR product.tax_rate > 100 THEN 'invalid_tax_rate'
    WHEN product.track_stock
      AND NOT product.is_service
      AND product.stock_quantity IS NULL THEN 'tracked_null_stock'
    WHEN product.track_stock
      AND NOT product.is_service
      AND product.stock_quantity < 0 THEN 'tracked_negative_stock'
    WHEN product.track_stock
      AND NOT product.is_service
      AND COALESCE(product.stock_quantity, 0) = 0 THEN 'tracked_zero_stock'
    ELSE 'inactive_or_unavailable'
  END AS checkout_risk
FROM public.products product
LEFT JOIN public.branches branch ON branch.id = product.branch_id
CROSS JOIN parameters
WHERE (parameters.branch_id IS NULL OR product.branch_id = parameters.branch_id)
  AND (
    branch.id IS NULL
    OR product.tenant_id IS DISTINCT FROM branch.tenant_id
    OR product.price IS NULL
    OR product.price < 0
    OR product.tax_rate IS NULL
    OR product.tax_rate < 0
    OR product.tax_rate > 100
    OR (
      product.track_stock
      AND NOT product.is_service
      AND (
        product.stock_quantity IS NULL
        OR product.stock_quantity <= 0
      )
    )
    OR NOT product.is_active
    OR NOT product.is_available
  )
ORDER BY product.updated_at DESC NULLS LAST
LIMIT 30;

-- D. Commercial integrity and recent checkout evidence. No idempotency value
-- is returned; only its presence and length are shown.
WITH parameters AS (
  SELECT
    NULLIF(current_setting('app.checkout_diagnostic_branch_id'), '')::uuid
      AS branch_id,
    current_setting('app.checkout_diagnostic_window')::interval AS window_size
)
SELECT
  invoice.id AS invoice_id,
  invoice.invoice_number,
  invoice.tenant_id,
  invoice.branch_id,
  invoice.created_at,
  invoice.status::text AS status,
  invoice.payment_status::text AS payment_status,
  invoice.zatca_status::text AS zatca_status,
  invoice.zatca_invoice_type::text AS invoice_type,
  invoice.total_amount,
  invoice.session_id,
  invoice.checkout_idempotency_key IS NOT NULL AS idempotency_key_present,
  length(invoice.checkout_idempotency_key) AS idempotency_key_length,
  item.item_count,
  payment.payment_count,
  payment.recorded_payment_total,
  movement.stock_movement_count,
  CASE
    WHEN item.item_count = 0 THEN 'missing_items'
    WHEN payment.payment_count = 0 THEN 'missing_payment'
    ELSE 'commercial_rows_present'
  END AS commercial_state
FROM public.invoices invoice
LEFT JOIN LATERAL (
  SELECT count(*) AS item_count
  FROM public.invoice_items invoice_item
  WHERE invoice_item.invoice_id = invoice.id
) item ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) AS payment_count,
    COALESCE(sum(invoice_payment.amount), 0) AS recorded_payment_total
  FROM public.payments invoice_payment
  WHERE invoice_payment.invoice_id = invoice.id
) payment ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS stock_movement_count
  FROM public.pos_stock_movements stock_movement
  WHERE stock_movement.invoice_id = invoice.id
) movement ON true
CROSS JOIN parameters
WHERE invoice.created_at >= clock_timestamp() - parameters.window_size
  AND invoice.original_invoice_id IS NULL
  AND (
    parameters.branch_id IS NULL
    OR invoice.branch_id = parameters.branch_id
  )
ORDER BY invoice.created_at DESC
LIMIT 50;

WITH parameters AS (
  SELECT NULLIF(
    current_setting('app.checkout_diagnostic_branch_id'),
    ''
  )::uuid AS branch_id
)
SELECT
  invoice.tenant_id,
  invoice.branch_id,
  invoice.invoice_number,
  count(*) AS duplicate_count,
  min(invoice.created_at) AS first_created_at,
  max(invoice.created_at) AS last_created_at
FROM public.invoices invoice
CROSS JOIN parameters
WHERE parameters.branch_id IS NULL OR invoice.branch_id = parameters.branch_id
GROUP BY invoice.tenant_id, invoice.branch_id, invoice.invoice_number
HAVING count(*) > 1
ORDER BY max(invoice.created_at) DESC
LIMIT 30;

WITH parameters AS (
  SELECT
    NULLIF(current_setting('app.checkout_diagnostic_branch_id'), '')::uuid
      AS branch_id,
    current_setting('app.checkout_diagnostic_window')::interval AS window_size
)
SELECT
  movement.id AS movement_id,
  movement.tenant_id,
  movement.branch_id,
  movement.invoice_id,
  movement.product_id,
  movement.quantity_delta,
  movement.reason,
  movement.created_at
FROM public.pos_stock_movements movement
LEFT JOIN public.invoices invoice ON invoice.id = movement.invoice_id
CROSS JOIN parameters
WHERE movement.created_at >= clock_timestamp() - parameters.window_size
  AND invoice.id IS NULL
  AND (
    parameters.branch_id IS NULL
    OR movement.branch_id = parameters.branch_id
  )
ORDER BY movement.created_at DESC
LIMIT 30;

DO $diagnostic_atomic_intents$
DECLARE
  v_branch_id uuid := NULLIF(
    current_setting('app.checkout_diagnostic_branch_id'),
    ''
  )::uuid;
  v_window interval :=
    current_setting('app.checkout_diagnostic_window')::interval;
  v_result jsonb;
BEGIN
  IF to_regclass('public.zatca_atomic_checkout_intents_v2') IS NULL THEN
    v_result := jsonb_build_object(
      'table_present', false,
      'recent_intents', 'unavailable'
    );
  ELSE
    EXECUTE $query$
      SELECT jsonb_build_object(
        'table_present', true,
        'recent_intents',
        COALESCE(jsonb_agg(to_jsonb(safe_row)), '[]'::jsonb)
      )
      FROM (
        SELECT
          intent.id AS attempt_id,
          intent.invoice_id,
          intent.branch_id,
          intent.document_type,
          intent.state,
          intent.failure_code,
          intent.created_at,
          intent.updated_at,
          intent.committed_at,
          length(intent.idempotency_key) AS idempotency_key_length
        FROM public.zatca_atomic_checkout_intents_v2 intent
        WHERE intent.created_at >= clock_timestamp() - $1
          AND ($2::uuid IS NULL OR intent.branch_id = $2)
        ORDER BY intent.created_at DESC
        LIMIT 30
      ) safe_row
    $query$
    INTO v_result
    USING v_window, v_branch_id;
  END IF;

  RAISE NOTICE 'checkout_diagnostic.atomic_intents=%', v_result;
END
$diagnostic_atomic_intents$;

-- E. ZATCA is downstream from public.pos_checkout. The function-body probe
-- detects accidental network/outbox/finalization coupling without printing the
-- function definition.
SELECT
  md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure))
    AS pos_checkout_definition_md5,
  position(
    'zatca_reporting_outbox'
    IN lower(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure))
  ) = 0 AS no_reporting_outbox_dependency,
  position(
    'finalize_zatca'
    IN lower(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure))
  ) = 0 AS no_finalization_dependency,
  position(
    'http'
    IN lower(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure))
  ) = 0 AS no_http_dependency,
  obj_description(
    'public.pos_checkout(jsonb)'::regprocedure,
    'pg_proc'
  ) AS function_comment;

WITH parameters AS (
  SELECT
    NULLIF(current_setting('app.checkout_diagnostic_branch_id'), '')::uuid
      AS branch_id,
    current_setting('app.checkout_diagnostic_window')::interval AS window_size
)
SELECT
  invoice.branch_id,
  invoice.zatca_status::text AS zatca_status,
  invoice.zatca_invoice_type::text AS invoice_type,
  count(*) AS invoice_count,
  min(invoice.created_at) AS first_created_at,
  max(invoice.created_at) AS last_created_at
FROM public.invoices invoice
CROSS JOIN parameters
WHERE invoice.created_at >= clock_timestamp() - parameters.window_size
  AND (
    parameters.branch_id IS NULL
    OR invoice.branch_id = parameters.branch_id
  )
GROUP BY
  invoice.branch_id,
  invoice.zatca_status,
  invoice.zatca_invoice_type
ORDER BY max(invoice.created_at) DESC;

DO $diagnostic_outbox$
DECLARE
  v_branch_id uuid := NULLIF(
    current_setting('app.checkout_diagnostic_branch_id'),
    ''
  )::uuid;
  v_window interval :=
    current_setting('app.checkout_diagnostic_window')::interval;
  v_result jsonb;
BEGIN
  IF to_regclass('public.zatca_reporting_outbox_v2') IS NULL THEN
    v_result := jsonb_build_object(
      'table_present', false,
      'recent_outbox', 'unavailable'
    );
  ELSE
    EXECUTE $query$
      SELECT jsonb_build_object(
        'table_present', true,
        'recent_outbox',
        COALESCE(jsonb_agg(to_jsonb(safe_row)), '[]'::jsonb)
      )
      FROM (
        SELECT
          outbox.id,
          outbox.invoice_id,
          outbox.branch_id,
          outbox.status,
          outbox.attempt_count,
          outbox.last_outcome,
          NULLIF(outbox.last_error, '') IS NOT NULL AS last_error_present,
          outbox.created_at,
          outbox.updated_at,
          outbox.accepted_at
        FROM public.zatca_reporting_outbox_v2 outbox
        WHERE outbox.created_at >= clock_timestamp() - $1
          AND ($2::uuid IS NULL OR outbox.branch_id = $2)
        ORDER BY outbox.created_at DESC
        LIMIT 30
      ) safe_row
    $query$
    INTO v_result
    USING v_window, v_branch_id;
  END IF;

  RAISE NOTICE 'checkout_diagnostic.reporting_outbox=%', v_result;
END
$diagnostic_outbox$;

ROLLBACK;
