# Recovered production UI baseline

This worktree is the durable source baseline reconstructed from the clean
modern v1.0.5 candidate `097d2ee870c3754b7ff8a36eee84b99e7fa4289`.

The baseline is source-controlled and maintainable. The public production
bundle was used only as a comparison oracle; compiled production assets and
minified output were not copied into `src/`.

Validation completed on 2026-08-24:

- `npm run build`
- `npm run test:final-web-printing-refinements`
- `npm run test:modern-statement-a4`
- `npm run test:accounting-ledger-a4`
- `npm run test:contemporary-modular-a4`
- `npm run test:phase4g-invoice-release-readiness`
- `npm run test:zatca-finalization-v2`
- `git diff --check`

No deployment, Edge Function change, production data change, or Sandbox
acceptance action is part of this recovery commit.
