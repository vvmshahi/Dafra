-- Reviewed compatibility alignment for the two commercial functions patched by
-- atomic simplified checkout v2.
--
-- This migration changes function definitions and execution privileges only.
-- It does not invoke either function and contains no business-table DML.

BEGIN;

DO $align_atomic_commercial_functions$
DECLARE
  v_pos_signature regprocedure := to_regprocedure('public.pos_checkout(jsonb)');
  v_credit_signature regprocedure := to_regprocedure('public.create_partial_credit_note(jsonb)');
  v_definition text;
  v_observed_hash text;
  v_anchor_offset integer;

  v_pos_production_hash constant text := 'bdc4ee5a02be05aa8b1d7378ebb84c0f';
  v_pos_release_canonical_hash constant text := 'b810798d8d9b64248f06ae67c6d95f90';
  v_pos_aligned_hash constant text := '68d6d28ff7ed53ad8b79180b3e26592b';
  v_pos_owner_anchor constant text := 'ELSIF v_profile.role = ''owner'' THEN';
  v_pos_owner_admin_anchor constant text := 'ELSIF v_profile.role IN (''owner'', ''admin'') THEN';
  v_pos_id_anchor constant text := 'v_invoice_id UUID := pg_catalog.gen_random_uuid();';
  v_pos_reviewed_declaration constant text :=
    '-- Reviewed atomic compatibility: branch same-branch; owner/admin same-tenant.'
    || E'\n  ' || v_pos_id_anchor;

  v_credit_production_hash constant text := 'c69249c13a29f0ff3d10c6529d7bca89';
  v_credit_release_canonical_hash constant text := '2789273cfedb900ae02d178eded85f90';
  v_credit_aligned_hash constant text := 'ea38d6800970cf51594e27c11c376ebd';
  v_credit_owner_anchor constant text := 'ELSIF v_profile.role = ''owner'' THEN';
  v_credit_owner_admin_anchor constant text := 'ELSIF v_profile.role IN (''owner'', ''admin'') THEN';
  v_credit_id_anchor constant text := 'v_credit_note_id UUID := pg_catalog.gen_random_uuid();';
  v_credit_variable_anchor constant text :=
    'v_existing_refund_total NUMERIC(12, 2) := 0;';
  v_credit_variable_replacement constant text :=
    v_credit_variable_anchor
    || E'\n  v_demo_sandbox_eligible BOOLEAN := FALSE;';
  v_credit_reviewed_declaration constant text :=
    '-- Reviewed atomic compatibility: scoped owner/admin access; permanent-demo exception retained.'
    || E'\n  ' || v_credit_id_anchor;
  v_credit_standard_guard constant text := $standard_guard$
  IF v_original.zatca_status NOT IN ('reported', 'cleared') THEN
    RAISE EXCEPTION 'Only reported or cleared invoices can be credited' USING ERRCODE = '23514';
  END IF;$standard_guard$;
  v_credit_production_guard constant text := $production_guard$
  IF v_original.zatca_status NOT IN ('reported', 'cleared')
     AND NOT (
       v_original.tenant_id = 'ebf1144b-55ed-472a-99c9-23b5ee915351'::uuid
       AND v_original.branch_id IN (
         '14271653-b404-44bf-9f39-7e9927569c02'::uuid,
         'c30094d7-40ca-4d2e-833a-07aa18c4fa46'::uuid
       )
       AND EXISTS (
         SELECT 1
         FROM public.zatca_sandbox_validation_attempts validation_attempt
         WHERE validation_attempt.invoice_id = v_original.id
           AND validation_attempt.tenant_id = v_original.tenant_id
           AND validation_attempt.branch_id = v_original.branch_id
           AND validation_attempt.status IN ('sandbox_validated', 'sandbox_validated_with_warnings')
       )
     ) THEN
    RAISE EXCEPTION 'Only reported, cleared, or successfully demo-submitted invoices can be credited' USING ERRCODE = '23514';
  END IF;$production_guard$;
  v_credit_compatible_guard constant text := $compatible_guard$
  IF v_original.zatca_status NOT IN ('reported', 'cleared') THEN
    IF v_original.tenant_id = 'ebf1144b-55ed-472a-99c9-23b5ee915351'::uuid
       AND v_original.branch_id IN (
         '14271653-b404-44bf-9f39-7e9927569c02'::uuid,
         'c30094d7-40ca-4d2e-833a-07aa18c4fa46'::uuid
       )
    THEN
      IF to_regclass('public.zatca_sandbox_validation_attempts') IS NULL THEN
        RAISE EXCEPTION 'Sandbox validation evidence table is required' USING ERRCODE = '55000';
      END IF;
      EXECUTE $demo_evidence$
        SELECT EXISTS (
          SELECT 1
          FROM public.zatca_sandbox_validation_attempts validation_attempt
          WHERE validation_attempt.invoice_id = $1
            AND validation_attempt.tenant_id = $2
            AND validation_attempt.branch_id = $3
            AND validation_attempt.status IN ('sandbox_validated', 'sandbox_validated_with_warnings')
        )
      $demo_evidence$
      INTO v_demo_sandbox_eligible
      USING v_original.id, v_original.tenant_id, v_original.branch_id;
    END IF;

    IF v_demo_sandbox_eligible IS NOT TRUE THEN
      RAISE EXCEPTION 'Only reported, cleared, or successfully demo-submitted invoices can be credited' USING ERRCODE = '23514';
    END IF;
  END IF;$compatible_guard$;
BEGIN
  IF v_pos_signature IS NULL OR v_credit_signature IS NULL THEN
    RAISE EXCEPTION
      'ATOMIC_COMMERCIAL_ALIGNMENT_FUNCTION_MISSING:pos=%,credit=%',
      v_pos_signature,
      v_credit_signature;
  END IF;

  -- Production already has the reviewed owner/admin policy. A clean release
  -- database has the owner-only canonical definition, which is promoted to the
  -- same reviewed compatibility definition before its deterministic marker is
  -- installed.
  v_definition := pg_get_functiondef(v_pos_signature);
  v_observed_hash := md5(v_definition);
  IF v_observed_hash = v_pos_aligned_hash THEN
    NULL;
  ELSIF v_observed_hash IN (v_pos_production_hash, v_pos_release_canonical_hash) THEN
    IF v_observed_hash = v_pos_release_canonical_hash THEN
      IF strpos(v_definition, v_pos_owner_anchor) = 0 THEN
        RAISE EXCEPTION 'ATOMIC_POS_ALIGNMENT_OWNER_ANCHOR_MISSING';
      END IF;
      v_definition := replace(v_definition, v_pos_owner_anchor, v_pos_owner_admin_anchor);
    END IF;

    IF strpos(v_definition, v_pos_owner_admin_anchor) = 0
       OR strpos(v_definition, '''document_language''') = 0
       OR strpos(v_definition, 'v_profile.role = ''branch''') = 0
       OR strpos(v_definition, 'v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id') = 0
       OR strpos(v_definition, 'v_profile.branch_id IS DISTINCT FROM v_branch.id') = 0
    THEN
      RAISE EXCEPTION 'ATOMIC_POS_ALIGNMENT_POLICY_DRIFT';
    END IF;

    v_anchor_offset := strpos(v_definition, v_pos_id_anchor);
    IF v_anchor_offset = 0
       OR strpos(
         substr(v_definition, v_anchor_offset + length(v_pos_id_anchor)),
         v_pos_id_anchor
       ) > 0
    THEN
      RAISE EXCEPTION 'ATOMIC_POS_ALIGNMENT_ID_ANCHOR_INVALID';
    END IF;

    v_definition := replace(v_definition, v_pos_id_anchor, v_pos_reviewed_declaration);
    EXECUTE v_definition;
  ELSE
    RAISE EXCEPTION
      'ATOMIC_POS_ALIGNMENT_HASH_DRIFT:expected production %, release %, or aligned %; observed %',
      v_pos_production_hash,
      v_pos_release_canonical_hash,
      v_pos_aligned_hash,
      v_observed_hash;
  END IF;

  v_definition := pg_get_functiondef(v_credit_signature);
  v_observed_hash := md5(v_definition);
  IF v_observed_hash = v_credit_aligned_hash THEN
    NULL;
  ELSIF v_observed_hash IN (v_credit_production_hash, v_credit_release_canonical_hash) THEN
    IF v_observed_hash = v_credit_release_canonical_hash THEN
      IF strpos(v_definition, v_credit_owner_anchor) = 0
         OR strpos(v_definition, v_credit_standard_guard) = 0
      THEN
        RAISE EXCEPTION 'ATOMIC_CREDIT_ALIGNMENT_CANONICAL_ANCHOR_MISSING';
      END IF;
      v_definition := replace(
        v_definition,
        v_credit_owner_anchor,
        v_credit_owner_admin_anchor
      );
      v_definition := replace(
        v_definition,
        v_credit_standard_guard,
        v_credit_compatible_guard
      );
    ELSE
      IF strpos(v_definition, v_credit_production_guard) = 0 THEN
        RAISE EXCEPTION 'ATOMIC_CREDIT_ALIGNMENT_PRODUCTION_ANCHOR_MISSING';
      END IF;
      v_definition := replace(
        v_definition,
        v_credit_production_guard,
        v_credit_compatible_guard
      );
    END IF;

    IF strpos(v_definition, v_credit_owner_admin_anchor) = 0
       OR strpos(v_definition, 'v_profile.role = ''branch''') = 0
       OR strpos(v_definition, 'v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id') = 0
       OR strpos(v_definition, 'v_profile.branch_id IS DISTINCT FROM v_original.branch_id') = 0
       OR strpos(v_definition, 'ebf1144b-55ed-472a-99c9-23b5ee915351') = 0
       OR strpos(v_definition, '14271653-b404-44bf-9f39-7e9927569c02') = 0
       OR strpos(v_definition, 'c30094d7-40ca-4d2e-833a-07aa18c4fa46') = 0
       OR strpos(v_definition, '''sandbox_validated''') = 0
       OR strpos(v_definition, '''sandbox_validated_with_warnings''') = 0
    THEN
      RAISE EXCEPTION 'ATOMIC_CREDIT_ALIGNMENT_POLICY_DRIFT';
    END IF;

    v_anchor_offset := strpos(v_definition, v_credit_variable_anchor);
    IF v_anchor_offset = 0
       OR strpos(
         substr(v_definition, v_anchor_offset + length(v_credit_variable_anchor)),
         v_credit_variable_anchor
       ) > 0
    THEN
      RAISE EXCEPTION 'ATOMIC_CREDIT_ALIGNMENT_VARIABLE_ANCHOR_INVALID';
    END IF;
    v_definition := replace(
      v_definition,
      v_credit_variable_anchor,
      v_credit_variable_replacement
    );

    v_anchor_offset := strpos(v_definition, v_credit_id_anchor);
    IF v_anchor_offset = 0
       OR strpos(
         substr(v_definition, v_anchor_offset + length(v_credit_id_anchor)),
         v_credit_id_anchor
       ) > 0
    THEN
      RAISE EXCEPTION 'ATOMIC_CREDIT_ALIGNMENT_ID_ANCHOR_INVALID';
    END IF;

    v_definition := replace(
      v_definition,
      v_credit_id_anchor,
      v_credit_reviewed_declaration
    );
    EXECUTE v_definition;
  ELSE
    RAISE EXCEPTION
      'ATOMIC_CREDIT_ALIGNMENT_HASH_DRIFT:expected production %, release %, or aligned %; observed %',
      v_credit_production_hash,
      v_credit_release_canonical_hash,
      v_credit_aligned_hash,
      v_observed_hash;
  END IF;
END
$align_atomic_commercial_functions$;

REVOKE ALL ON FUNCTION public.pos_checkout(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_partial_credit_note(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb) TO authenticated;

COMMENT ON FUNCTION public.pos_checkout(jsonb) IS
  'Reviewed pre-atomic POS checkout: branch same-branch and owner/admin same-tenant.';
COMMENT ON FUNCTION public.create_partial_credit_note(jsonb) IS
  'Reviewed pre-atomic partial credit note: scoped owner/admin access and permanent-demo Sandbox exception retained.';

DO $assert_atomic_commercial_alignment$
DECLARE
  v_pos_signature regprocedure := 'public.pos_checkout(jsonb)'::regprocedure;
  v_credit_signature regprocedure := 'public.create_partial_credit_note(jsonb)'::regprocedure;
  v_pos_hash text := md5(pg_get_functiondef(v_pos_signature));
  v_credit_hash text := md5(pg_get_functiondef(v_credit_signature));
  v_security_definer boolean;
  v_config text[];
BEGIN
  IF v_pos_hash <> '68d6d28ff7ed53ad8b79180b3e26592b' THEN
    RAISE EXCEPTION
      'ATOMIC_POS_ALIGNMENT_POST_HASH_MISMATCH:expected %, observed %',
      '68d6d28ff7ed53ad8b79180b3e26592b',
      v_pos_hash;
  END IF;
  IF v_credit_hash <> 'ea38d6800970cf51594e27c11c376ebd' THEN
    RAISE EXCEPTION
      'ATOMIC_CREDIT_ALIGNMENT_POST_HASH_MISMATCH:expected %, observed %',
      'ea38d6800970cf51594e27c11c376ebd',
      v_credit_hash;
  END IF;

  SELECT p.prosecdef, p.proconfig
  INTO v_security_definer, v_config
  FROM pg_proc p
  WHERE p.oid = v_pos_signature;
  IF v_security_definer IS NOT TRUE
     OR NOT COALESCE(v_config @> ARRAY['search_path=public', 'row_security=off'], false)
  THEN
    RAISE EXCEPTION 'ATOMIC_POS_ALIGNMENT_SECURITY_CONFIG_MISMATCH';
  END IF;

  SELECT p.prosecdef, p.proconfig
  INTO v_security_definer, v_config
  FROM pg_proc p
  WHERE p.oid = v_credit_signature;
  IF v_security_definer IS NOT TRUE
     OR NOT COALESCE(v_config @> ARRAY['search_path=public', 'row_security=off'], false)
  THEN
    RAISE EXCEPTION 'ATOMIC_CREDIT_ALIGNMENT_SECURITY_CONFIG_MISMATCH';
  END IF;

  IF has_function_privilege('anon', v_pos_signature, 'EXECUTE')
     OR has_function_privilege('anon', v_credit_signature, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_pos_signature, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_credit_signature, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ATOMIC_COMMERCIAL_ALIGNMENT_EXECUTE_GRANT_MISMATCH';
  END IF;
END
$assert_atomic_commercial_alignment$;

NOTIFY pgrst, 'reload schema';

COMMIT;
