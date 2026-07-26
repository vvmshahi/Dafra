\set ON_ERROR_STOP on

-- Read-only deployment gate between compatibility alignment and the atomic
-- migration. The atomic migration accepts only these aligned hashes.
BEGIN TRANSACTION READ ONLY;

WITH expected(signature, expected_hash) AS (
  VALUES
    ('public.pos_checkout(jsonb)', '68d6d28ff7ed53ad8b79180b3e26592b'),
    ('public.create_partial_credit_note(jsonb)', 'ea38d6800970cf51594e27c11c376ebd')
),
observed AS (
  SELECT
    e.signature,
    e.expected_hash,
    to_regprocedure(e.signature) AS function_oid
  FROM expected e
)
SELECT
  o.signature,
  o.expected_hash,
  CASE
    WHEN o.function_oid IS NULL THEN NULL
    ELSE md5(pg_get_functiondef(o.function_oid))
  END AS observed_hash,
  CASE
    WHEN o.function_oid IS NULL THEN 'MISSING'
    WHEN md5(pg_get_functiondef(o.function_oid)) = o.expected_hash THEN 'PASS'
    ELSE 'FAIL'
  END AS hash_result,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM observed o
LEFT JOIN pg_proc p ON p.oid = o.function_oid
ORDER BY o.signature;

DO $verify_atomic_commercial_alignment$
DECLARE
  v_pos regprocedure := 'public.pos_checkout(jsonb)'::regprocedure;
  v_credit regprocedure := 'public.create_partial_credit_note(jsonb)'::regprocedure;
  v_pos_definition text := pg_get_functiondef(v_pos);
  v_credit_definition text := pg_get_functiondef(v_credit);
BEGIN
  IF md5(v_pos_definition) <> '68d6d28ff7ed53ad8b79180b3e26592b'
     OR md5(v_credit_definition) <> 'ea38d6800970cf51594e27c11c376ebd'
  THEN
    RAISE EXCEPTION 'ATOMIC_COMMERCIAL_ALIGNMENT_HASH_VERIFICATION_FAILED';
  END IF;

  IF strpos(v_pos_definition, 'v_profile.role = ''branch''') = 0
     OR strpos(v_pos_definition, 'v_profile.role IN (''owner'', ''admin'')') = 0
     OR strpos(v_credit_definition, 'v_profile.role = ''branch''') = 0
     OR strpos(v_credit_definition, 'v_profile.role IN (''owner'', ''admin'')') = 0
     OR strpos(v_credit_definition, 'ebf1144b-55ed-472a-99c9-23b5ee915351') = 0
     OR strpos(v_credit_definition, '14271653-b404-44bf-9f39-7e9927569c02') = 0
     OR strpos(v_credit_definition, 'c30094d7-40ca-4d2e-833a-07aa18c4fa46') = 0
     OR strpos(v_credit_definition, '''sandbox_validated''') = 0
     OR strpos(v_credit_definition, '''sandbox_validated_with_warnings''') = 0
  THEN
    RAISE EXCEPTION 'ATOMIC_COMMERCIAL_ALIGNMENT_POLICY_VERIFICATION_FAILED';
  END IF;
END
$verify_atomic_commercial_alignment$;

ROLLBACK;
