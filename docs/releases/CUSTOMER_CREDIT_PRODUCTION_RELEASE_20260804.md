# Customer Credit Production Release — 2026-08-04

Status: production promoted; authenticated browser acceptance remains blocked.

## Release identity

- Starting feature SHA: `605e3124d6d37f6a59d3cf1b642249dd50ca4f03`
- Final tested feature SHA: `678842b7953668fb0c7f7fc294ebe6bc81b013c2`
- Cleanup commit: `678842b7953668fb0c7f7fc294ebe6bc81b013c2`
- Merge rehearsal SHA: `5fddb6ee06590aaba03ede070ef23007bac9ceae`
- Main merge SHA: `3bb8611345bfa82fce9e4c458fca296d212a20d9`
- Stable tag: not created; authenticated smoke gate is incomplete.

## Verification

- StatementPreview: stale report assertion updated; preview remains in the shared customer workspace panel. Focused statement contracts pass.
- Branch/Owner settings: stale `businessCustomerCredit` and removed report `statementsTab` assertions updated to the current approved contracts. The suite passes.
- Full web test suite: passed.
- Receivables certification: passed with the local Supabase stack running.
- Focused Customer Credit, POS, payment projection, statements, XLSX, thermal, A4, ZATCA Service Demo, and Trading restriction contracts: passed.
- TypeScript/Vite build: passed on the feature tree and merge rehearsal tree.
- `git diff --check`: passed.
- Migration parity: local and remote both end at `20260804001000`.

## Temporary Trading tooling

The V2/reconnect controls remain isolated to the exact Demo tenant and Trading
branch, Owner/Super Admin roles, and development/Preview builds. The Preview
flag is enabled only for Preview. The production bundle does not expose the
debug flag. Service Demo UI/routing remains separate and unchanged.

## Trading and Edge state

- Trading Demo remains `non_fiscal`.
- No OTP, ZATCA upstream issuance, invoice, or financial transaction was run during release verification.
- `zatca-onboard-sandbox-demo`: v31 before/after.
- `zatca-onboard-trading-sandbox-v2`: v12 before/after.
- Remote migration head: `20260804001000`.

## Deployment

- Production deployment: `dpl_91dU7329AyaVoErwxcubfuMPVJCK`
- Production source SHA: `3bb8611345bfa82fce9e4c458fca296d212a20d9`
- State: READY
- Aliases: `kubri.shop`, `www.kubri.shop`, `dafra.vercel.app`
- Previous production deployment: `dafra-7uccwlb46-mohammed-shahin-v-vs-projects.vercel.app` (source `78adbe9f4be6e267f206deff2ff71d05ee4ffeb1`)
- Exact tested Preview: `dafra-6c0c2ntlb-mohammed-shahin-v-vs-projects.vercel.app`
- Preview source SHA: `678842b7953668fb0c7f7fc294ebe6bc81b013c2`

Production HTTP smoke confirmed the root mount, successful asset delivery,
and no missing Supabase environment error. Authenticated Owner/Branch login
and interactive Customer Credit, statement PDF/XLSX, Service Demo, and
ordinary-tenant visibility checks were not run because no safe disposable
credentials or authenticated browser session were available.

## Deferred issue

Complete the authenticated Preview acceptance matrix, then create and push the
stable release tag. Trading Demo Sandbox V2 remains non-fiscal and isolated.
