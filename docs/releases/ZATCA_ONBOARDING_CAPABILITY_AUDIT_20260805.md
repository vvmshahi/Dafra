# ZATCA Production Onboarding Capability Audit — 2026-08-05

## Official interpretation

Kubri uses the official TSXY map: `1000` Standard only, `0100` Simplified
only, and `1100` both. X and Y remain `0`. Source: [ZATCA Developer Portal
User Manual](https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Documents/Developer%20Portal%20User%20Manual.pdf)
and [ZATCA Detailed Technical Guideline](https://www.zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf).

## Findings and changes

- The normal Production onboarding UI previously exposed three choices,
  including Standard/B2B-only. It now exposes only Retail (`0100`) and Retail
  + Business (`1100`). `1000` remains recognized for existing/imported devices.
- A shared typed contract in `shared/zatcaCapability.ts` maps
  `simplified_only → 0100`, `standard_and_simplified → 1100`, and
  `standard_only → 1000`.
- The selected capability is converted to the exact request map at submission;
  server validation remains fail-closed for malformed, unknown, or reserved-bit
  values.
- CSR generation already places the selected map in the ZATCA title field.
- Compliance samples already select Simplified, Standard, or both families from
  the map. `1100` therefore requires all six samples.
- Onboarding state now records requested and, when upstream supplies it, issued
  functionality maps. An issued/requested mismatch fails with
  `ZATCA_FUNCTIONALITY_MAP_MISMATCH`; no automatic downgrade occurs.
- No existing credential row, functionality map, Branch, invoice, or fiscal
  document was changed.

## Jaman Global metadata audit

The linked project returned four active records matching “Jaman Global”, not the
three expected by the audit request. No active Production credential exists on
any returned record. Two are `not_started` and eligible for the revised flow
without Branch recreation; two are `compliance_failed` records with stored
`1100` selection and require owner review before retry. Credential material was
not queried.

## Verification status

Passed: functionality-map contract test, TypeScript check, and `git diff --check`.

Blocked: migration parity and Preview verification. The linked remote still has
remote-only migration `20260804001100`; the new additive migration
`20260805000200_persist_zatca_capability_selection.sql` is not applied. No OTP,
Production credential request, Preview deployment, or Production deployment was
performed.

## Recommendation

Resolve migration parity and review the four Jaman Global records before Preview
deployment. Production onboarding remains blocked until Preview verification
passes.
