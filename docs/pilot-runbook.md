# Pilot Runbook

Phase 5C-1 runbook for the first 1-10 paying customers.

## 1. Pre-Pilot Deployment Checklist

- Confirm the target Supabase project and frontend URL.
- Apply pending SQL manually before deploying frontend code that depends on it.
- Deploy changed Edge Functions before frontend flows depend on them.
- Deploy frontend last.
- Hard refresh the browser after deploy.
- Run `docs/pilot-smoke-checklist.md`.

## 2. Customer Onboarding Steps

- Confirm business name, owner email, city, phone, plan, branch limit, and business type.
- In Super Admin, create the client account.
- Copy the owner setup link from the success screen.
- Send the setup link to the owner manually by WhatsApp or email.
- Tell the owner the link may expire and can be regenerated if needed.

## 3. Owner Setup Link Manual Send

- The `create-owner-account` Edge Function generates a Supabase recovery/setup link.
- The link is shown only to a verified super admin in the create-client success state.
- Do not post the setup link in public channels.
- If the link is missing or expired, send a manual password reset from Supabase Auth.

## 4. Branch Creation And Limit Check

- Confirm the tenant branch limit in Super Admin before onboarding.
- Owner creates branches from Settings -> Branches.
- Before 5-10 customers: move branch creation and branch limit enforcement server-side.

## 5. ZATCA Onboarding Checklist

- Confirm branch legal name, VAT number, CR/license, National Address fields, invoice language, and Phase 2 plan.
- Use Settings -> ZATCA for production onboarding.
- Use a valid Fatoorah OTP.
- Confirm the branch shows production connected.
- Do not disconnect or reconnect production unless necessary.

## 6. First Invoice Smoke Test

- Open a POS session.
- Add an item to cart.
- Complete cash checkout.
- Confirm receipt appears and prints if required.
- Confirm invoice status becomes reported or cleared for Phase 2.
- If submission fails, use the failed ZATCA SOP below.

## 7. Credit Note Smoke Test

- Open a reported or cleared invoice.
- Create a full credit note.
- Confirm the credit note submits to ZATCA.
- For service tenants, confirm stock is not returned.
- For trading tenants, confirm return-to-stock remains available where expected.

## 8. Reports Smoke Test

- Sales Report loads.
- VAT Support Report loads.
- Purchase Report loads.
- Expense Report loads.
- Profit Estimate loads.
- Credit notes reduce sales and VAT.
- POS quick expenses do not contribute input VAT.
- Detailed claimable expenses contribute input VAT only with receipt evidence.

## 9. What To Ask When A Customer Reports An Issue

- Business name or client code if available.
- Branch name or branch code if available.
- Invoice number, credit note number, or purchase reference.
- Screenshot.
- Time of issue with timezone.
- User email and role.
- What action they clicked immediately before the issue.

## 10. Failed ZATCA SOP

- Open Operations -> ZATCA Health.
- Identify failed or pending invoices.
- Open the invoice detail page.
- Retry ZATCA submission.
- If several retries fail, collect invoice number, branch, time, and screenshot.
- Do not reconnect or disconnect ZATCA unless the current production connection is known to be wrong.

## 11. Deployment And Rollback Note

- SQL first if frontend or Edge code depends on new columns/functions.
- Edge Function deploy next if changed.
- Frontend deploy after SQL and Edge Function.
- Hard refresh browser after deploy.
- If a frontend deploy fails, roll back the frontend deployment.
- If an SQL patch fails, stop and do not deploy dependent frontend or Edge changes.

## 12. What Not To Promise

- Do not call reports audited accounting.
- Do not call VAT Support an official VAT return.
- Do not promise FIFO, true COGS, BOM, or full accounting.
- Do not claim official ZATCA certification unless legally verified.
- Say the app supports ZATCA Phase 2 e-invoicing workflows and live submission when configured.

