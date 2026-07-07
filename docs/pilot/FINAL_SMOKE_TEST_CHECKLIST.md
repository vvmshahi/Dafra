# Kubri POS Final Smoke Test Checklist

Run this checklist before first customer onboarding, after production changes, and after any rollback. Mark each item as pass, fail, or not applicable.

## A. Authentication And Roles

- [ ] Super admin login works.
- [ ] Owner login works.
- [ ] Branch username login works.
- [ ] Inactive user is blocked from normal access.
- [ ] Suspended tenant cannot open new POS/register workflows as intended.
- [ ] Unauthorized users see a friendly message and are not unexpectedly logged out.

## B. Owner/Admin

- [ ] Owner dashboard loads.
- [ ] Branch overview loads.
- [ ] Branch user create/reset password flow works.
- [ ] Branch limit behavior is visible and enforced.
- [ ] Subscription/payment visibility loads.
- [ ] Onboarding status is accurate.
- [ ] Owner/admin can view tenant-wide invoices and reports as intended.
- [ ] Owner/admin cannot access Super Admin.

## C. Branch Operations

- [ ] POS checkout cash works.
- [ ] POS checkout card works.
- [ ] POS split payment works where enabled.
- [ ] Receipt print works.
- [ ] Invoice list loads.
- [ ] Invoice detail loads.
- [ ] Products page loads and branch-scoped operations work.
- [ ] Inventory page loads and branch-scoped operations work.
- [ ] Customers page loads and branch-scoped operations work.
- [ ] Suppliers page loads and branch-scoped operations work.
- [ ] Purchases page loads.
- [ ] Purchase receiving works.
- [ ] Purchase receiving reversal works.
- [ ] Expenses page loads.
- [ ] Expense receipt upload works.
- [ ] Reports load for branch user.
- [ ] Day closing/register close works.
- [ ] Branch settings needed for operation load.

## D. Security Checks

- [ ] Direct invoice insert from browser/client is rejected.
- [ ] Direct invoice_items insert from browser/client is rejected.
- [ ] Direct payments insert from browser/client is rejected.
- [ ] Branch user cannot access another branch's data.
- [ ] Branch user cannot access Super Admin.
- [ ] Owner cannot access Super Admin.
- [ ] Owner cannot hard-delete branch or tenant.
- [ ] Branch user cannot hard-delete branch or tenant.
- [ ] Inactive users cannot use sensitive functions.
- [ ] Edge logs do not expose secrets, tokens, OTPs, certificate material, or full sensitive payloads.

## E. ZATCA

- [ ] Sandbox/compliance flow works if applicable.
- [ ] Production onboarding flow works if applicable.
- [ ] Invoice submission works.
- [ ] Failed invoice submit retry works.
- [ ] Credit note submission works.
- [ ] QR/hash/XML fields are generated as expected.
- [ ] Error handling shows actionable messages without exposing secrets.
- [ ] Support wording avoids certification, approval, partner-status, guarantee, or absolute-compliance claims.

## F. Desktop/Printing

- [ ] Web receipt print works.
- [ ] Android/browser receipt print works if applicable.
- [ ] Electron direct printer setting works if applicable.
- [ ] Mac installer note is available if distributing desktop app.
- [ ] Windows installer note is available if distributing desktop app.
- [ ] Desktop app update limitation is explained to pilot users.

## G. Reports

- [ ] Dashboard cards load.
- [ ] VAT report loads.
- [ ] Sales report loads.
- [ ] Purchase report loads.
- [ ] Expense report loads.
- [ ] Profit report loads.
- [ ] Customer report loads.
- [ ] Branch/session report loads.
- [ ] Reports use support/estimate wording where appropriate.

## H. Billing/Onboarding

- [ ] Create client works.
- [ ] Resend owner setup link works.
- [ ] Mark owner setup complete works.
- [ ] Mark payment received works.
- [ ] Payment history loads.
- [ ] Suspend tenant works.
- [ ] Unsuspend tenant works.
- [ ] Branch limit enforcement works.
- [ ] Branch limit update after payment works.

## I. Final Go/No-Go Decision

- [ ] Pass: ready to onboard pilot customer.
- [ ] Pass with known limitations: ready with written limitations and support plan.
- [ ] No-go: do not onboard until blockers are fixed.

Decision notes:

- Date:
- Operator:
- Environment:
- Frontend commit/version:
- SQL phases applied:
- Edge Functions deployed:
- Known limitations:
- Follow-up owner:
