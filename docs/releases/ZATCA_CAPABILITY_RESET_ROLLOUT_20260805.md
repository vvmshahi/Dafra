# ZATCA Capability and Failed-Onboarding Reset Rollout — 2026-08-05

## Migration reconciliation

The remote-only migration `20260804001100_credit_note_receivables_visibility.sql`
was recovered exactly from Git object `88e345db7227fece04042f4c5d7f00c20c0b0dbc`.
The restored working-tree file matches that object byte-for-byte. It is a
credit-note visibility/guardrail migration and is not reapplied remotely.

## Reset safety

`20260805000200_persist_zatca_capability_selection.sql` adds an archive-only,
service-role RPC. The Edge Function performs Owner authorization and exact
Branch scoping before invoking it. It accepts only `compliance_failed` rows with
no active or uncertain Production credential, archives safe historical metadata,
clears only the current failed onboarding state, and leaves the Branch and
fiscal records unchanged. It makes no ZATCA request. The UI requires
`RESET ONBOARDING` and is hidden for `not_started` and active credentials.

The reset was not executed during this rollout.

## Gate status

Remote migration parity is reconciled through `20260804001100`; migrations
`20260805000200` remains pending review/application. No OTP,
ZATCA endpoint, Production deployment, or Preview deployment was performed.
