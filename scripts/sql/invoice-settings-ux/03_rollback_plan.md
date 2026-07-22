# Rollback plan

Before execution, capture `pg_get_functiondef` for all three existing V1 functions. Restore those exact definitions with `CREATE OR REPLACE FUNCTION` if reconciliation must be reverted. No invoice rollback is required because the package updates only `branches.presentation_settings`; no Storage objects or policies are changed. Temporarily hide the two new controls and omit their JSON keys if the RPC reconciliation is deferred.
