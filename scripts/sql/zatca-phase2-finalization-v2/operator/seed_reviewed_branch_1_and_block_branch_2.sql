-- PREPARED ONLY. Do not run without the reviewed maintenance authorization.
-- Seeds the reviewed coherent tail for branch 1 and explicitly blocks branch 2.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $guard$
DECLARE
  v_latest record;
  v_bad_links bigint;
  v_tail_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.zatca_finalization_runtime
    WHERE singleton = true
      AND (immutable_finalization_enabled OR simplified_enabled OR standard_enabled)
  ) THEN RAISE EXCEPTION 'ZATCA_FLAGS_MUST_REMAIN_FALSE_DURING_SEED'; END IF;

  IF to_regclass('public.zatca_branch_readiness_v2') IS NULL THEN
    RAISE EXCEPTION 'BRANCH_READINESS_MIGRATION_NOT_APPLIED';
  END IF;

  SELECT id, invoice_number, zatca_counter_number, zatca_xml_hash
  INTO v_latest
  FROM public.invoices
  WHERE branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
    AND zatca_status IN ('reported', 'cleared')
    AND zatca_counter_number IS NOT NULL
    AND NULLIF(btrim(zatca_xml_hash), '') IS NOT NULL
  ORDER BY zatca_counter_number DESC, zatca_submitted_at DESC NULLS LAST
  LIMIT 1;

  IF v_latest.zatca_counter_number IS DISTINCT FROM 860
     OR v_latest.zatca_xml_hash IS DISTINCT FROM
       '0rt4rBEZvug668xBtEWMyKjvip70PJip0H9Fq2TkQSo=' THEN
    RAISE EXCEPTION 'REVIEWED_BRANCH_1_TAIL_CHANGED';
  END IF;

  WITH accepted AS (
    SELECT i.* FROM public.invoices i
    WHERE i.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
      AND i.zatca_status IN ('reported', 'cleared')
      AND i.zatca_counter_number IS NOT NULL
      AND NULLIF(btrim(i.zatca_xml_hash), '') IS NOT NULL
  ), tail AS (
    SELECT a.*, row_number() OVER (
      ORDER BY zatca_counter_number DESC, zatca_submitted_at DESC NULLS LAST
    ) AS rn
    FROM accepted a
  ), linked AS (
    SELECT t.*,
      (
        SELECT p.zatca_xml_hash FROM accepted p
        WHERE p.zatca_counter_number < t.zatca_counter_number
        ORDER BY p.zatca_counter_number DESC, p.zatca_submitted_at DESC NULLS LAST
        LIMIT 1
      ) AS expected_pih
    FROM tail t WHERE rn <= 5
  )
  SELECT count(*), count(*) FILTER (
    WHERE zatca_prev_invoice_hash IS DISTINCT FROM expected_pih
  ) INTO v_tail_count, v_bad_links
  FROM linked;

  IF v_tail_count <> 5 OR v_bad_links <> 0 THEN
    RAISE EXCEPTION 'BRANCH_1_REVIEWED_TAIL_IS_NOT_COHERENT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
      AND zatca_status IN ('pending', 'failed')
  ) THEN RAISE EXCEPTION 'BRANCH_1_HAS_UNRESOLVED_INVOICES'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.zatca_chain_heads_v2
    WHERE branch_id IN (
      '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid,
      'b2b4fd13-b6db-4baa-b353-4eaab842ed50'::uuid
    )
  ) THEN RAISE EXCEPTION 'TARGET_CHAIN_HEAD_ALREADY_EXISTS'; END IF;
END
$guard$;

SELECT public.seed_zatca_chain_head_v2(
  '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid,
  860,
  '0rt4rBEZvug668xBtEWMyKjvip70PJip0H9Fq2TkQSo=',
  'Reviewed coherent accepted tail through counter 860; operator approval required.'
);

SELECT public.approve_zatca_branch_readiness_v2(
  '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid,
  'controlled_reconciliation',
  'Reviewed coherent accepted tail through counter 860.',
  NULL
);

SELECT public.block_zatca_branch_v2(
  'b2b4fd13-b6db-4baa-b353-4eaab842ed50'::uuid,
  'Historical and recovery-chain forks require separate ZATCA/operator approval.',
  NULL
);

DO $postcondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.zatca_chain_heads_v2 h
    JOIN public.zatca_branch_readiness_v2 r USING (tenant_id, branch_id)
    WHERE h.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
      AND h.last_committed_counter = 860
      AND h.last_committed_hash =
        '0rt4rBEZvug668xBtEWMyKjvip70PJip0H9Fq2TkQSo='
      AND r.readiness_status = 'ready'
  ) THEN RAISE EXCEPTION 'BRANCH_1_SEED_POSTCONDITION_FAILED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zatca_branch_readiness_v2
    WHERE branch_id = 'b2b4fd13-b6db-4baa-b353-4eaab842ed50'::uuid
      AND readiness_status = 'blocked'
  ) THEN RAISE EXCEPTION 'BRANCH_2_BLOCK_POSTCONDITION_FAILED'; END IF;
END
$postcondition$;

COMMIT;
