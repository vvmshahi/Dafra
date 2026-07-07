# Kubri POS Pilot Operations Runbook

## Purpose

This runbook is the operating guide for the first Kubri POS pilot customers. It is designed for manual onboarding, support, billing follow-up, and safe production operations before scaling beyond the first 30-50 customers.

Kubri POS should be described as supporting ZATCA Phase 2 invoicing workflows, ZATCA-ready invoicing workflows, and QR invoices. Avoid certification, government approval, partner-status, guarantee, or absolute-compliance claims unless legally verified.

## Pilot Readiness Status

The current pilot readiness baseline includes:

- Financial direct browser writes are locked down for `invoices`, `invoice_items`, and `payments`.
- POS checkout and approved RPC/service paths remain the authoritative financial write paths.
- Branch users remain day-to-day branch operators.
- Super-admin destructive tenant and branch delete paths are hardened for active super admins only.
- Edge Functions have active-profile checks and reduced sensitive logging.
- Branch operation references are scoped to tenant/branch to prevent cross-branch reference abuse.
- Expense receipt uploads use the tenant/branch/expenses storage path format for new uploads.

## Current Deployment Model

- SQL migrations are applied manually.
- Edge Functions are deployed manually.
- Frontend deployment is separate from SQL and Edge Function deployment.
- Production data must not be modified directly except through approved admin workflows.
- Run smoke tests after any production change.

Recommended change order:

1. Backup production.
2. Run preflight checks for the SQL phase.
3. Apply SQL manually only if preflight is acceptable.
4. Deploy Edge Functions only if changed.
5. Deploy frontend only after dependent backend changes are live.
6. Hard refresh browser sessions.
7. Run final smoke tests.

## Environments And Important Project Refs

- Brand: Kubri POS
- Domain: `kubri.shop`
- Supabase project ref: `bkbphkpqcxuejozayrsy`
- Support email: `support@kubri.shop`
- WhatsApp support: `https://wa.me/971561373210`
- Working branch: `phase-2-zatca-production-onboarding`

Keep secrets out of tickets, chat, docs, screenshots, and support messages.

## Manual Onboarding Workflow

1. Collect business details, owner contact, VAT readiness, branch count, and payment preference.
2. Confirm the customer understands pricing, support channel, and pilot limitations.
3. Create the client/tenant from Super Admin.
4. Create or invite the owner account.
5. Send the owner setup link privately.
6. Confirm owner password setup and first login.
7. Create branches and branch users.
8. Configure invoice settings, printer, products, stock, suppliers, customers, and ZATCA workflow as needed.
9. Run a test invoice and receipt print.
10. Record payment and branch coverage.
11. Mark onboarding status accurately.

## Owner Account Setup Workflow

1. Super admin creates the owner account or resends setup link.
2. Send the setup link by WhatsApp or email only to the verified owner.
3. Owner sets a password through the setup/reset page.
4. Owner logs in.
5. Confirm owner setup completion appears in Super Admin.
6. If the link expires, resend a fresh setup link.

## Branch User Setup Workflow

1. Owner/admin or super admin creates the branch user for the correct branch.
2. Assign a branch username and temporary password according to the current supported workflow.
3. Share credentials privately.
4. Confirm branch user can log in and sees only branch-scoped operational pages.
5. Confirm branch user cannot access Super Admin or other branch data.

## Username Login Workflow

1. Branch user opens the branch username login flow.
2. User enters assigned username and password.
3. Confirm branch assignment after login.
4. If login fails, verify user is active, tenant is not suspended, branch is active, and credentials are current.
5. For forgotten passwords, reset through the supported branch user reset process.

## Subscription And Payment Workflow

Pilot pricing:

- SAR 100/month/branch
- SAR 1,000/year/branch
- No free trial
- 7-day money-back guarantee

Operational steps:

1. Confirm selected billing period and paid branch count.
2. Record payment in Super Admin when received.
3. Keep payment proof outside the app if needed, but do not store card secrets.
4. Confirm payment history and next due date.
5. Update branch limits only after payment/approval.
6. Follow up before due date for manual renewal.

## Suspension Workflow

Use suspension only for deliberate administrative reasons such as non-payment, abuse, or customer request.

1. Confirm the tenant and reason.
2. Prefer warning the owner before suspension when possible.
3. Suspend from Super Admin.
4. Confirm new POS checkout and new register session opening are blocked.
5. Confirm old invoices, reports, and register close remain available as intended.
6. Unsuspend only after the reason is resolved.

Do not auto-suspend tenants based only on billing dates unless that behavior is intentionally implemented later.

## Branch Limit Workflow

1. Confirm paid branch count and maximum branch limit.
2. Owner/admin may create branches within the allowed limit.
3. When the limit is reached, advise the customer to contact Kubri support.
4. Super admin updates branch limit after approval/payment.
5. Never bypass server-side branch limit checks with direct database edits.

## ZATCA Onboarding Workflow

Use cautious language: ZATCA Phase 2 workflows, ZATCA-ready invoicing workflows, QR invoices.

1. Collect legal business name, VAT number, CR/license details, and National Address details.
2. Confirm branch invoice settings are complete.
3. Confirm whether sandbox/compliance or production onboarding is being used.
4. Enter the Fatoorah OTP only through the intended secure workflow.
5. Confirm the branch shows the expected onboarding state.
6. Submit a test invoice where appropriate.
7. If submission fails, collect invoice number, branch, timestamp, and error details.
8. Do not disconnect/reconnect production ZATCA settings unless the current connection is known to be wrong.

## POS Daily Operation Workflow

1. Branch user logs in.
2. Open register session if required.
3. Confirm products and prices.
4. Run cash/card/split checkout as needed.
5. Print or share receipt.
6. Handle refunds/credit notes through approved flows only.
7. Close register/day when operations end.

## Register Open/Close Workflow

Open:

1. Select branch.
2. Enter opening cash.
3. Confirm no existing open register session.
4. Open register.

Close:

1. Review cash/card totals.
2. Enter closing cash.
3. Review variance.
4. Close session.
5. Save or print session summary if needed.

Suspended tenants should not open new sessions, but existing operational records should remain readable.

## Receipt And Printing Workflow

1. Confirm branch invoice settings and receipt footer.
2. For browser printing, open receipt and use print.
3. For device printer setup, configure branch-level printer settings.
4. For Electron/direct printing, confirm the correct printer is selected.
5. If printing fails, test browser print first, then device printer, then Electron settings.

## Refund And Credit Note Workflow

1. Open the original invoice.
2. Confirm invoice eligibility and customer request.
3. Use approved credit note/refund action.
4. Confirm totals and stock behavior before submitting.
5. Submit credit note to ZATCA workflow where applicable.
6. Confirm original invoice and credit note remain linked/readable.

Do not manually edit financial rows to simulate refunds.

## Purchase And Expense Workflow

Purchases:

1. Create or select supplier.
2. Create purchase bill for the correct branch.
3. Add purchase items.
4. Confirm receiving if stock should update.
5. Reverse receiving only through the approved flow when needed.

Expenses:

1. Create expense for the correct branch.
2. Select category.
3. Add receipt if input VAT evidence is needed.
4. Confirm expense appears in reports.
5. New receipt uploads should use tenant/branch/expenses storage paths.

## Desktop App Update Notes

- Web deployment updates do not automatically update installed desktop apps.
- Mac and Windows installer builds should be versioned and announced to pilot customers.
- Keep a note of which customers use browser only versus desktop/Electron.
- If a desktop issue occurs, confirm app version, OS, printer model, and whether the browser version works.

## Support Process

Primary channels:

- Email: `support@kubri.shop`
- WhatsApp: `https://wa.me/971561373210`

For each issue, collect:

- Business name
- Branch name
- User role
- Invoice, purchase, expense, or session reference
- Timestamp and timezone
- Screenshot or short screen recording
- What the user clicked immediately before the issue

## Incident Response

Severity guide:

- Critical: checkout unavailable, data exposure, tenant isolation failure, ZATCA production submission blocked for live customer.
- High: owner/branch login unavailable, reports materially wrong, printing unavailable for customer operations.
- Medium: one workflow degraded with workaround.
- Low: cosmetic or wording issue.

Response steps:

1. Acknowledge the issue.
2. Stop risky changes if an incident is active.
3. Preserve logs and screenshots.
4. Identify affected tenant, branch, user, and timeframe.
5. Reproduce in a safe environment where possible.
6. Decide fix forward, rollback, or manual workaround.
7. Communicate status and resolution.
8. Document the incident and prevention step.

## Rollback Process

Frontend rollback:

1. Identify last known-good deployment.
2. Roll back frontend deployment.
3. Hard refresh and smoke test.

Edge Function rollback:

1. Identify last known-good function source in git.
2. Redeploy that version manually.
3. Test only the affected function path.

SQL rollback:

1. Do not run ad hoc destructive rollback.
2. Review backup availability.
3. Prefer forward fix for non-destructive schema issues.
4. Restore only after confirming blast radius and downtime plan.

## Known Limitations

- Pilot onboarding and billing are manual.
- No free trial automation.
- Desktop app updates may require customer action.
- Support is handled manually through email/WhatsApp.
- ZATCA workflows depend on correct business/branch setup and authority responses.
- Do not treat reports as audited accounting outputs.
- Backup restore must be tested before relying on it during an incident.

## Final Go/No-Go Checklist

- [ ] Latest SQL phases reviewed and applied manually where intended.
- [ ] Backups verified before risky changes.
- [ ] Super admin login works.
- [ ] Owner login works.
- [ ] Branch username login works.
- [ ] Branch user can access branch operations.
- [ ] Branch user cannot access Super Admin.
- [ ] POS cash/card/split checkout works.
- [ ] Receipt print works.
- [ ] Reports load.
- [ ] ZATCA workflow tested where applicable.
- [ ] Direct financial table browser writes are rejected.
- [ ] Suspended tenant behavior is confirmed.
- [ ] Branch limit behavior is confirmed.
- [ ] Support templates are ready.
- [ ] Customer onboarding checklist is ready.
