# Pilot Smoke Checklist

Run this after manual SQL apply, Edge deploy, and frontend deploy.

## Deployment Prerequisites

- [ ] Apply `supabase/phase5b3c-expense-vat-claimability.sql` manually if not already applied.
- [ ] Apply `supabase/phase5b3d-business-type-reporting-mode.sql` manually if not already applied.
- [ ] Deploy `create-owner-account` Edge Function.
- [ ] Deploy frontend.
- [ ] Hard refresh browser.

## Onboarding

- [ ] Super admin creates Trading tenant/owner.
- [ ] Owner setup link is visible to super admin after creation.
- [ ] Copy setup link works.
- [ ] Owner setup link opens reset/setup password flow.
- [ ] Owner logs in.
- [ ] Owner creates branch.
- [ ] Branch limit matches Super Admin setting.

## POS And ZATCA

- [ ] POS checkout works.
- [ ] Normal invoice reports to ZATCA.
- [ ] Credit note reports to ZATCA.
- [ ] Invoice retry path is visible for failed or pending ZATCA submissions.
- [ ] Operations/ZATCA Health shows failed and pending documents.

## Reports

- [ ] Sales Report loads.
- [ ] VAT Support Report loads.
- [ ] Purchase Report loads.
- [ ] Expense Report loads.
- [ ] Profit Estimate loads.
- [ ] Reports still use estimate/support wording.

## Expenses

- [ ] POS quick expense is non-claimable.
- [ ] POS quick expense reduces cash by the entered amount.
- [ ] POS quick expense does not appear as input VAT.
- [ ] Detailed claimable expense requires receipt evidence.
- [ ] Detailed claimable expense calculates VAT from paid amount.

## Business Type

- [ ] Service tenant credit note does not restock.
- [ ] Trading tenant credit note can restock when selected.
- [ ] Branch/cashier cannot change business type.
- [ ] Owner/admin can view business type in settings.

## Regression Checks

- [ ] POS checkout still works after hard refresh.
- [ ] Normal ZATCA report still works.
- [ ] Credit note ZATCA report still works.
- [ ] Stock page opens from sidebar.
- [ ] Purchases page opens from sidebar.

