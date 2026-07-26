-- OPERATOR STEP. Do not execute as part of an audit or recovery dry run.
--
-- Installs the recurring server-side consumer for zatca_reporting_outbox_v2.
-- Required Vault secrets:
--   zatca_edge_project_url      e.g. https://<project-ref>.supabase.co
--   zatca_edge_service_role_key legacy gateway-accepted service-role JWT
--   zatca_outbox_dispatch_token random token matching the Edge environment
--                                ZATCA_OUTBOX_DISPATCH_TOKEN
--
-- The Edge finalize request also starts a best-effort server-side drain after
-- commit. This cron job is the durable backstop when that invocation is lost.

BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'PG_CRON_EXTENSION_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'PG_NET_EXTENSION_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'zatca_edge_project_url' AND NULLIF(decrypted_secret, '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'ZATCA_EDGE_PROJECT_URL_VAULT_SECRET_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'zatca_edge_service_role_key' AND NULLIF(decrypted_secret, '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'ZATCA_EDGE_SERVICE_ROLE_KEY_VAULT_SECRET_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'zatca_outbox_dispatch_token' AND NULLIF(decrypted_secret, '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'ZATCA_OUTBOX_DISPATCH_TOKEN_VAULT_SECRET_REQUIRED'; END IF;
END
$preflight$;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'zatca-reporting-outbox-v2';

SELECT cron.schedule(
  'zatca-reporting-outbox-v2',
  '* * * * *',
  $dispatch$
    SELECT net.http_post(
      url := (
        SELECT rtrim(decrypted_secret, '/') || '/functions/v1/zatca-submit'
        FROM vault.decrypted_secrets
        WHERE name = 'zatca_edge_project_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'zatca_edge_service_role_key'
        ),
        'apikey', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'zatca_edge_service_role_key'
        ),
        'X-Zatca-Dispatch-Token', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'zatca_outbox_dispatch_token'
        )
      ),
      body := '{"action":"drain_outbox","batchSize":10}'::jsonb,
      timeout_milliseconds := 50000
    );
  $dispatch$
);

COMMIT;
