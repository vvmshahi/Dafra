# Android print and A4 preview hotfix — 2026-08-04

## Status

Preview is ready from hotfix commit `adf61c0686c6c5eef00c59ca718d38359b78c2be`.
Production promotion and release tagging are intentionally blocked pending
real Android Chrome acceptance.

## Root causes

- Browser snapshot printing removed its print CSS as soon as `window.print()`
  returned. Android can return before the native print surface is populated.
- Browser receipt printing used a 1px, opacity-hidden iframe. Android Chrome can
  open a blank native print preview for hidden iframe content.
- The A4 preview canvas was responsive-width and inherited viewport constraints
  instead of keeping a fixed physical A4 canvas with a screen-only scale layer.

## Fix

- Added a bounded browser print readiness helper for images, fonts, layout, and
  `afterprint` cleanup.
- Browser invoice and receipt printing now opens a visible authenticated print
  window synchronously from the user action, with a controlled popup-blocked
  message.
- A4 print roots use `210mm × 297mm`, `@page { size: A4; margin: 0; }`, and
  screen-only preview scaling.
- Thermal receipt rendering and document calculations were not changed.

## Verification

- Focused Android/A4 regression checks: passed.
- Full `npm test`: passed.
- Receivables certification: passed.
- TypeScript/typecheck: passed.
- Production build: passed.
- `git diff --check`: passed.
- Real Android device/browser checks: not available in this environment.
- Preview browser check is protected by Vercel access control and returned the
  Vercel login page to unauthenticated requests.

## Deployment

- Preview deployment: `dpl_8b3Wrka2XJLXkGoYFAmvWbMRbHkf`
- Preview URL: https://dafra-rbel8wk1n-mohammed-shahin-v-vs-projects.vercel.app
- Production deployment: not performed.
- Production aliases: unchanged.
- Release tag: not created.
- Rollback SHA/deployment: current production baseline remains unchanged;
  rollback target is the prior production deployment.

No fiscal, invoice, payment, customer-credit, stock, ZATCA, or historical data
was mutated by this hotfix or its verification.
