# Owner account provisioning incident — 2026-08-01

## Incident

At approximately 2026-08-01 12:55 IST, Super Admin client creation from
/super-admin/clients returned HTTP 503. The affected request was for the Phase
2 plan at SAR 100 per branch/month, with three branches selected, manual
recurring payment, one-month duration, and a calculated SAR 300 amount.

The attempted customer identity is intentionally omitted from this document.

## Deployment evidence

| Component | Before fix |
| --- | --- |
| Production frontend | Vercel deployment dpl_UHxqvdsKVUwuiKW8xX97SpXbZJSz |
| Frontend source | main at 549138965417c6343abf9775590464d17c0d9f4a |
| Edge Function | create-owner-account version 73, ACTIVE, verify_jwt false |
| Function source lineage | feature/final-web-printing-ui-refinements-20260729 at 7b0bd54a63b7fd1f7cf9c58d338379a3a833bdb8 |
| Function deployment time before incident | 2026-07-28T12:48:41.153Z |

The downloaded deployed function source matched the cited source lineage
byte-for-byte. The production function performs its own caller JWT and active
Super Admin validation, so verify_jwt remains false by design.

## Root cause

The request had no VAT number. The Edge Function normalized missing VAT to an
empty string and stored it in the durable provisioning request. The
transactional core then attempted to insert that empty string into
public.tenants.vat_number.

Production has a UNIQUE(vat_number) constraint and already contains one tenant
with an empty VAT value. The tenant insert therefore failed, rolling back the
transactional core and returning CORE_DATABASE_FAILED / HTTP 503.

This was not a missing function, gateway, authorization, plan, secret, or
timeout failure:

- create-owner-account was ACTIVE and reachable;
- Phase 2 was active and allowlisted;
- required production secret names were configured (values not inspected or
  recorded);
- the deployed and local core/acquire RPC definition fingerprints matched;
- the failure occurred after durable Auth identity creation and before core
  tenant/subscription completion.

## Partial-state result

The failed attempt has exactly one durable provisioning request in
failed_recoverable / CORE_DATABASE_FAILED state, with two attempts. It has an
Auth identity and active owner profile without a tenant assignment. It has zero
tenant, active subscription, and onboarding records. No record was deleted,
modified, or retried for this incident.

The provisioner already uses a normalized-email unique request plus stable
fingerprint. The original fingerprint represents blank VAT as an empty string,
so a same-request retry can reacquire the existing operation.

## Narrow fix

Commit f186953 on hotfix/owner-account-provisioning-20260801:

1. New requests normalize blank VAT to NULL. PostgreSQL UNIQUE permits multiple
   NULL values, unlike an empty string.
2. The request fingerprint deliberately retains the legacy empty-string
   representation for blank VAT. Existing durable requests therefore replay
   rather than conflict.
3. Before an incomplete request resumes its core step, the Edge Function
   changes only a legacy request_payload.vat_number value of empty string to
   NULL. It preserves all other stored fields and the fingerprint.
4. Core database failures now emit structured, redacted telemetry containing
   provisioning id, stable failure code, database error code when available,
   and duration. No payload, password, token, setup link, or service key is
   logged or returned.

No schema migration, purchase migration, RLS/grant change, frontend deployment,
mobile deployment, or unrelated function deployment was made.

## Deployment

| Item | Value |
| --- | --- |
| Production project | bkbphkpqcxuejozayrsy |
| Deployed function | create-owner-account only |
| Hotfix commit | f1869533 |
| Deployed function version | 74 |
| Deployment timestamp | 2026-08-01T07:40:27.696Z |
| Function verification mode | verify_jwt false, unchanged |

## Validation

- Focused provisioning security contract test: PASS.
- Edge deployment successfully compiled/bundled the function.
- Production OPTIONS probe: 200 with POST, OPTIONS allowed.
- Production unauthenticated POST probe: controlled 401 UNAUTHORIZED.
- These probes execute before provisioning acquisition and created no records.
- The failed customer operation was checked again after deployment and remains
  unretried with no core business rows.

The local Supabase container expected by this worktree was unavailable, so the
full local runtime suite could not be run in this incident window.

## HTTP 400

No browser request id/correlation id or response body for the separate HTTP 400
was available. It cannot be connected to the 503 from the durable request or
function state. The selected Phase 2 plan was active and allowlisted, so it was
not the recorded provisioning core failure. If it recurs, capture its exact
endpoint, sanitized payload field names, response body, and request id before
treating it as a dependency.

## Remaining gate

A controlled end-to-end production creation and identical retry require an
explicitly authorised disposable email/account. No such identity was supplied,
so this incident did not create or retry a customer account.

Before closing the incident, use that disposable account to verify Phase 2,
three-branch entitlement, manual recurring one-month subscription, setup-link
generation, exactly one Auth user/tenant/subscription/onboarding row, and
identical-retry reconciliation. Use the approved deactivation/cleanup path
rather than manual deletion.

The incident preflight also found that the selected Phase 2 plan currently has
max_branches = 999 and complete_owner_provisioning_core uses that plan value;
the UI-supplied branch_count is not persisted by the current workflow. This did
not cause the VAT 503, but it prevents certifying the requested three-branch
entitlement. It needs an explicit product decision and separately tested,
idempotency-aware entitlement change rather than being folded into this narrow
availability hotfix.

## Safety confirmation

- No customer tenant, user, branch, subscription, invitation, billing, or
  onboarding record was deleted.
- No failed attempt was retried.
- No pending purchase migration was applied.
- No mobile work continued.
- Protected feature/invoice-settings-ux-redesign checkout was not modified.
