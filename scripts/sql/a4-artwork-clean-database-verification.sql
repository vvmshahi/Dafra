\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.tenants (id, name, vat_number)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A4 fixture tenant A', '300000000000001'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'A4 fixture tenant B', '300000000000002');

INSERT INTO public.branches (id, tenant_id, name, is_active)
VALUES
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A4 fixture branch A1', TRUE),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A4 fixture branch A2', TRUE),
  ('b1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'A4 fixture branch B1', TRUE);

INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('c1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'a4-owner@fixture.invalid', '{}', '{}', NOW(), NOW()),
  ('c2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'a4-branch@fixture.invalid', '{}', '{}', NOW(), NOW()),
  ('c3333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'a4-other@fixture.invalid', '{}', '{}', NOW(), NOW());

INSERT INTO public.user_profiles (id, tenant_id, branch_id, role, full_name, email, is_active)
VALUES
  ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'owner', 'Fixture owner', 'a4-owner@fixture.invalid', TRUE),
  ('c2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 'branch', 'Fixture branch', 'a4-branch@fixture.invalid', TRUE),
  ('c3333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'owner', 'Fixture other owner', 'a4-other@fixture.invalid', TRUE)
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    branch_id = EXCLUDED.branch_id,
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    is_active = EXCLUDED.is_active;

DO $validators$
DECLARE
  settings JSONB;
  validated JSONB;
  layout TEXT;
BEGIN
  settings := public.default_invoice_presentation_settings('a1111111-1111-1111-1111-111111111111');

  FOREACH layout IN ARRAY ARRAY[
    'classic',
    'modern_split',
    'minimal_professional',
    'executive_green',
    'clean_ledger',
    'contemporary_border'
  ] LOOP
    validated := public.validate_invoice_presentation_settings(
      jsonb_set(
        jsonb_set(settings, '{a4,theme}', to_jsonb(layout), FALSE),
        '{a4,artwork_template_id}', to_jsonb(layout), FALSE
      ),
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1111111-1111-1111-1111-111111111111'
    );
    IF validated #>> '{a4,theme}' <> layout THEN
      RAISE EXCEPTION 'Layout did not round-trip: %', layout;
    END IF;
  END LOOP;

  validated := public.validate_invoice_presentation_settings(
    jsonb_set(
      jsonb_set(
        jsonb_set(settings, '{a4,accent_color}', '"#AABBCC"', FALSE),
        '{a4,heading_color}', '"#112233"', FALSE
      ),
      '{a4,header_asset_path}',
      '"tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/d1111111-1111-1111-1111-111111111111/header.webp"',
      FALSE
    ),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'a1111111-1111-1111-1111-111111111111'
  );
  IF validated #>> '{a4,accent_color}' <> '#aabbcc'
    OR validated #>> '{a4,heading_color}' <> '#112233'
    OR validated #>> '{a4,header_asset_path}' IS NULL THEN
    RAISE EXCEPTION 'Colour or artwork fields did not round-trip';
  END IF;

  PERFORM public.validate_invoice_presentation_settings(
    jsonb_build_object('identity', jsonb_build_object()),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'a1111111-1111-1111-1111-111111111111'
  );

  BEGIN
    PERFORM public.validate_invoice_presentation_settings(
      jsonb_set(settings, '{a4,theme}', '"unsafe_layout"', FALSE),
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1111111-1111-1111-1111-111111111111'
    );
    RAISE EXCEPTION 'Invalid layout was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.validate_invoice_presentation_settings(
      jsonb_set(settings, '{a4,header_crop_height}', '101', FALSE),
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1111111-1111-1111-1111-111111111111'
    );
    RAISE EXCEPTION 'Unsafe crop metadata was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.validate_invoice_presentation_settings(
      jsonb_set(
        settings,
        '{a4,header_asset_path}',
        '"tenant/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/branch/b1111111-1111-1111-1111-111111111111/invoice-artwork/d1111111-1111-1111-1111-111111111111/header.png"',
        FALSE
      ),
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'a1111111-1111-1111-1111-111111111111'
    );
    RAISE EXCEPTION 'Cross-tenant artwork metadata was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$validators$;

CREATE FUNCTION pg_temp.expect_denied(statement TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $expect_denied$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected operation to be denied: %', statement;
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN NULL;
END;
$expect_denied$;

CREATE FUNCTION pg_temp.assert_count(actual BIGINT, expected BIGINT, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $assert_count$
BEGIN
  IF actual <> expected THEN
    RAISE EXCEPTION '% (expected %, got %)', message, expected, actual;
  END IF;
END;
$assert_count$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', TRUE);

INSERT INTO storage.objects (id, bucket_id, name, metadata)
VALUES (
  'd1111111-1111-1111-1111-111111111111',
  'invoice-artwork',
  'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/e1111111-1111-1111-1111-111111111111/header.png',
  '{"fixture":true}'
);
SELECT pg_temp.assert_count(count(*), 1, 'owner select failed')
FROM storage.objects
WHERE id = 'd1111111-1111-1111-1111-111111111111';
UPDATE storage.objects SET metadata = '{"fixture":"updated"}'
WHERE id = 'd1111111-1111-1111-1111-111111111111';

SELECT pg_temp.expect_denied($sql$
  UPDATE storage.objects
  SET name = 'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a2222222-2222-2222-2222-222222222222/invoice-artwork/e1111111-1111-1111-1111-111111111111/header.png'
  WHERE id = 'd1111111-1111-1111-1111-111111111111'
$sql$);

SELECT pg_temp.expect_denied($sql$
  INSERT INTO storage.objects (bucket_id, name) VALUES (
    'invoice-artwork',
    'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/e2222222-2222-2222-2222-222222222222/../header.png'
  )
$sql$);
SELECT pg_temp.expect_denied($sql$
  INSERT INTO storage.objects (bucket_id, name) VALUES (
    'invoice-artwork',
    'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/e2222222-2222-2222-2222-222222222222/side.png'
  )
$sql$);
SELECT pg_temp.expect_denied($sql$
  INSERT INTO storage.objects (bucket_id, name) VALUES (
    'invoice-artwork',
    'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/e2222222-2222-2222-2222-222222222222/header.svg'
  )
$sql$);

SELECT set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', TRUE);
INSERT INTO storage.objects (id, bucket_id, name, metadata)
VALUES (
  'd2222222-2222-2222-2222-222222222222',
  'invoice-artwork',
  'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/e2222222-2222-2222-2222-222222222222/footer.webp',
  '{"fixture":true}'
);
UPDATE storage.objects SET metadata = '{"fixture":"branch-updated"}'
WHERE id = 'd2222222-2222-2222-2222-222222222222';
SELECT pg_temp.expect_denied($sql$
  INSERT INTO storage.objects (bucket_id, name) VALUES (
    'invoice-artwork',
    'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a2222222-2222-2222-2222-222222222222/invoice-artwork/e3333333-3333-3333-3333-333333333333/header.png'
  )
$sql$);

SELECT set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333333', TRUE);
SELECT pg_temp.assert_count(count(*), 0, 'cross-tenant select leaked')
FROM storage.objects
WHERE bucket_id = 'invoice-artwork';
SELECT pg_temp.expect_denied($sql$
  INSERT INTO storage.objects (bucket_id, name) VALUES (
    'invoice-artwork',
    'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/e3333333-3333-3333-3333-333333333333/header.png'
  )
$sql$);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', TRUE);
SELECT pg_temp.assert_count(count(*), 0, 'anonymous select leaked')
FROM storage.objects
WHERE bucket_id = 'invoice-artwork';
SELECT pg_temp.expect_denied($sql$
  INSERT INTO storage.objects (bucket_id, name) VALUES (
    'invoice-artwork',
    'tenant/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/branch/a1111111-1111-1111-1111-111111111111/invoice-artwork/e4444444-4444-4444-4444-444444444444/header.png'
  )
$sql$);

RESET ROLE;
ROLLBACK;

\echo 'A4 clean-database validators and Storage RLS matrix passed'
