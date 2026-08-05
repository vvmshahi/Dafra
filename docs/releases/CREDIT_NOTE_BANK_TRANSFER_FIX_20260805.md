# Credit Note Bank Transfer Refund Fix — 2026-08-05

## Scope

This release aligns the Credit Note refund allocation contract only. It does
not change historical invoices or credit notes, Customer Credit architecture,
ZATCA capability work, Electron packaging, or Production deployment.

## Root cause and fix

The Credit Note UI displayed “Bank transfer” while sending the persisted
allocation method `card`. The deployed
`create_partial_credit_note_with_refund(jsonb)` contract accepts `cash` and
`bank_transfer`, so the request failed with SQLSTATE `22023` during atomic
preparation. The UI now sends `bank_transfer`; migration
`20260805000100_align_credit_note_refund_method_contract.sql` aligns the
wrapper validation and preserves the existing transactional/idempotent
behavior.

The wrapper remains `SECURITY DEFINER`, uses `search_path = public, pg_temp`,
keeps row security disabled for its controlled server-side transaction, and
rejects the obsolete receivables-settlement field.

## Verification

- Focused Credit Note UX, invoice-identity, deterministic atomic-checkout, and
  full repository test suites passed.
- TypeScript check and production web build passed.
- The disposable local lifecycle previously passed with a 115.00
  bank-transfer Credit Note, zero remaining refundable amount, idempotent
  replay, one refund, one payment, zero receivables entries, zero stock
  movements, and zero retained fixture rows. The temporary runtime harness was
  unavailable for a second rerun.
- Remote migration head before rollout: `20260804001100`.
- Only `20260805000100` was applied; remote head after rollout:
  `20260805000100`.
- Remote safe contract checks passed for invalid-method rejection,
  bank-transfer method acceptance through validation, and RPC grants.

## Release gate

- Preview source: commit `944261d6cbb4ef47c3954441013a179013e3f62a`
- Preview deployment: `dpl_DBV4sKE3zryCok2TTMajwXRKe9pT`
- Preview URL: `https://dafra-eomxpmt4m-mohammed-shahin-v-vs-projects.vercel.app`
- Preview build: READY; the Vercel deployment probe returned HTTP 200 and the
  Kubri HTML shell loaded with the expected root/title. Anonymous direct HTTP
  is protected by the existing Vercel Preview login gate.
- Manual Credit Note acceptance: blocked pending an Owner session and an
  explicitly authorized disposable invoice. No OTP, Credit Note, payment,
  receivables, inventory, or ZATCA request was submitted.
- Production: not deployed
- Electron packaging: not performed
- Recommendation: hold Production until the controlled Preview acceptance
  pass is completed.
