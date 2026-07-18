# Kubri Saudi Arabic business glossary (draft)

This glossary is a localization working draft for Saudi Arabic review. The proposed Arabic phrases are contextual suggestions, not legally, tax, or commercially approved translations. A native Saudi Arabic reviewer familiar with retail, accounting, and ZATCA terminology must approve every entry before production use.

| Translation key | English phrase | Proposed Arabic phrase | Screen/context | Notes | Approval status |
| --- | --- | --- | --- | --- | --- |
| `pos.sale` | Sale | عملية بيع | POS, reports | Prefer the transactional meaning, not a promotion or discount. | Native review required |
| `invoices.invoice` | Invoice | فاتورة | Invoices, generic document references | Generic invoice label; use the tax-specific terms below when applicable. | Native review required |
| `invoices.taxInvoice` | Tax invoice | فاتورة ضريبية | Standard tax invoice and A4 output | Review against current ZATCA terminology. | Native review required |
| `invoices.simplifiedTaxInvoice` | Simplified tax invoice | فاتورة ضريبية مبسطة | B2C receipt and invoice output | Review against current ZATCA terminology. | Native review required |
| `creditNotes.creditNote` | Credit note | إشعار دائن | Credit-note workflow and documents | Accounting term; avoid a literal “credit invoice” rendering. | Native review required |
| `creditNotes.refund` | Refund | استرداد المبلغ | Refund action and outcome | Use where money is returned to the customer. | Native review required |
| `creditNotes.returnQuantity` | Return quantity | الكمية المرتجعة | Credit-note line editor | Refers to quantity being returned, not stock received. | Native review required |
| `payments.received` | Payment received | تم استلام الدفعة | Checkout and invoice payment state | Outcome/status wording. | Native review required |
| `payments.cash` | Cash | نقداً | Payment method | Confirm preferred product-wide spelling style. | Native review required |
| `payments.card` | Card | بطاقة | Payment method | May be expanded to “بطاقة دفع” if context is ambiguous. | Native review required |
| `payments.split` | Split payment | دفع مقسّم | Checkout and refund allocation | Means one transaction allocated across methods. | Native review required |
| `register.register` | Register | صندوق المبيعات | POS register and sessions | Review whether “الصندوق” is clearer in compact UI contexts. | Native review required |
| `register.openingCash` | Opening cash | الرصيد النقدي الافتتاحي | Open-register flow | Cash present at the start of a session. | Native review required |
| `register.expectedCash` | Expected cash | النقد المتوقع | Close-register reconciliation | System-calculated drawer cash. | Native review required |
| `register.actualCash` | Actual cash | النقد الفعلي | Close-register reconciliation | Counted drawer cash. | Native review required |
| `register.cashShort` | Cash short | عجز نقدي | Register variance | Negative cash variance; accounting context. | Native review required |
| `register.cashOver` | Cash over | زيادة نقدية | Register variance | Positive cash variance; accounting context. | Native review required |
| `inventory.stock` | Stock | المخزون | Products and inventory | Use consistently for inventory on hand. | Native review required |
| `inventory.adjustment` | Stock adjustment | تسوية المخزون | Inventory adjustment workflow | Review whether “تعديل المخزون” better matches merchant expectations. | Native review required |
| `purchases.purchase` | Purchase | عملية شراء | Purchases and reports | Transaction noun, not the imperative “buy.” | Native review required |
| `suppliers.supplier` | Supplier | مورّد | Suppliers and purchases | Common Saudi business term. | Native review required |
| `customers.customer` | Customer | عميل | POS and customer records | Generic customer label. | Native review required |
| `expenses.expense` | Expense | مصروف | Expenses and reports | Accounting noun. | Native review required |
| `common.vat` | VAT | ضريبة القيمة المضافة | Totals, settings, reports, invoices | Keep the acronym “VAT” only where space or mixed-language output requires it. | Native review required |
| `common.subtotal` | Subtotal | المجموع الفرعي | Checkout and documents | Amount before subsequent totals/adjustments. | Native review required |
| `common.discount` | Discount | خصم | POS and invoices | Distinguish from tax exemption. | Native review required |
| `common.total` | Total | الإجمالي | Checkout, documents, reports | Generic final total label. | Native review required |
| `printers.printReceipt` | Print receipt | طباعة الإيصال | POS completion and invoice detail | Action label. | Native review required |
| `pos.newSale` | New sale | عملية بيع جديدة | POS completion | Action starting a fresh cart. | Native review required |
| `register.close` | Close register | إغلاق الصندوق | Register session action | Confirm consistency with the chosen translation of register. | Native review required |
| `zatca.submitted` | Submitted | تم الإرسال | ZATCA document status | Must not imply acceptance, reporting, or clearance. | Native review required |
| `zatca.accepted` | Accepted | مقبول | ZATCA validation status | Use only when the backend result is actually accepted. | Native review required |
| `zatca.rejected` | Rejected | مرفوض | ZATCA validation status | Pair with safe actionable error details. | Native review required |
| `common.retry` | Retry | إعادة المحاولة | Recoverable errors | Action label; avoid implying duplicate submission. | Native review required |
| `navigation.sections.daily` | Daily | اليومية | Sidebar section | Groups routine branch actions; compact navigation heading. | Native review required |
| `navigation.sections.catalogue` | Catalogue | الكتالوج | Sidebar section | Groups products, stock, purchases, and suppliers. | Native review required |
| `navigation.sections.business` | Business | الأعمال | Sidebar section | Groups customer and expense records. | Native review required |
| `navigation.sections.administration` | Administration | الإدارة | Owner and internal navigation | Refers to account administration, not public-sector administration. | Native review required |
| `navigation.roles.branch` | Branch | الفرع | Account role | A branch-scoped user role; review against the preferred merchant-facing role name. | Native review required |
| `navigation.clients` | Clients | العملاء | Internal super-admin navigation | Refers to Kubri business accounts, while `customers.customer` refers to a merchant's customer. | Native review required |
| `auth.login.secureAccess` | Secure access | دخول آمن | Sign-in page | Short sign-in eyebrow; not a security certification claim. | Native review required |
| `auth.invitation.title` | Account creation is by invitation only | إنشاء الحسابات متاح بالدعوة فقط | Invitation page | Explains the controlled onboarding model. | Native review required |
| `dialogs.discard.title` | Discard changes? | تجاهل التغييرات؟ | Shared confirmation dialog | Used only when unsaved form state would be lost. | Native review required |
| `validation.permissionDenied` | You do not have permission to perform this action. | ليس لديك صلاحية لتنفيذ هذا الإجراء. | Shared authorization error | Avoid exposing backend policy or role details. | Native review required |

## Review rules

- Review phrases in their actual screen, receipt, and invoice context rather than in isolation.
- Preserve merchant-entered Arabic and English exactly; do not machine-translate stored business data.
- Keep VAT numbers, invoice identifiers, SKUs, barcodes, phone numbers, email addresses, URLs, and QR payloads directionally isolated and unchanged.
- Validate regulated invoice and ZATCA terminology with a qualified Saudi tax-domain reviewer before approval.
- Record approval per key, including reviewer and review date, before moving a phrase into production translation resources.
