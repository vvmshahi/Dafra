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
| `pos.title` | Point of Sale | نقطة البيع | Cashier POS page title | Use the familiar retail-system meaning. | Native review required |
| `pos.touchPos` | Touch POS | نقطة البيع باللمس | Touch catalogue mode | Compact mode label; not a hardware certification. | Native review required |
| `pos.quickBilling` | Quick Billing | الفوترة السريعة | Trading quick-billing mode | Refers to a faster catalogue/table workflow. | Native review required |
| `pos.searchProducts` | Search product name, SKU, or barcode | ابحث باسم المنتج أو SKU أو الباركود | POS product search | Preserve SKU and barcode terms and directional isolation. | Native review required |
| `pos.allProducts` | All products | كل المنتجات | POS category filter | Includes every active and available product in scope. | Native review required |
| `pos.addToCart` | Add to cart | إضافة إلى السلة | Product action | Retail cart, not inventory movement. | Native review required |
| `pos.currentOrder` | Current order | الطلب الحالي | POS cart heading | The in-progress sale before checkout. | Native review required |
| `pos.walkInCustomer` | Walk-in customer | عميل نقدي | Default POS customer | Review whether “عميل بدون حساب” is clearer for non-cash payments. | Native review required |
| `pos.netAmount` | Net amount | صافي المبلغ | POS and completion totals | Amount before VAT in the displayed calculation. | Native review required |
| `pos.charge` | Charge | تحصيل | Primary POS payment action | Means collect the displayed amount, not a fee. | Native review required |
| `payments.selectMethod` | Select payment method | اختر طريقة الدفع | Checkout payment controls | Method selection instruction. | Native review required |
| `payments.cash` | Cash | نقداً | POS payment method | Keep consistent with receipt and register terminology. | Native review required |
| `payments.card` | Card | بطاقة | POS payment method | Includes the configured card/POS terminal path. | Native review required |
| `payments.splitPayment` | Split payment | دفع مقسّم | Cash/card payment modal | One sale allocated between cash and card. | Native review required |
| `payments.amountDue` | Amount due | المبلغ المستحق | Checkout and sale completion | Exact amount required for the sale. | Native review required |
| `payments.amountReceived` | Amount received | المبلغ المستلم | Cash tender input | Cash handed over by the customer. | Native review required |
| `payments.changeDue` | Change due | الباقي للعميل | Cash sale completion | Cash to return to the customer. | Native review required |
| `payments.paymentReceived` | Payment received | تم استلام الدفعة | Sale-completion modal | Immediate checkout success; does not imply ZATCA completion. | Native review required |
| `register.register` | Register | صندوق المبيعات | POS register and sessions | Review whether compact screens can use “الصندوق”. | Native review required |
| `register.open` | Open register | فتح الصندوق | Start-register action | Starts a register session; not opening a physical drawer. | Native review required |
| `register.close` | Close register | إغلاق الصندوق | End-register action | Finalizes the current register session. | Native review required |
| `register.expectedCashDrawer` | Expected cash in drawer | النقد المتوقع في الصندوق | Close-register reconciliation | System-calculated cash using unchanged accounting rules. | Native review required |
| `register.actualCashCounted` | Actual cash counted | النقد الفعلي المعدود | Close-register input | Physical counted amount entered by the cashier. | Native review required |
| `register.cashShortBy` | Cash short by {amount} | عجز نقدي بمقدار {amount} | Register variance | Negative difference; amount remains LTR. | Native review required |
| `register.cashOverBy` | Cash over by {amount} | زيادة نقدية بمقدار {amount} | Register variance | Positive difference; amount remains LTR. | Native review required |
| `register.sessionSummary` | Session summary | ملخص الجلسة | Close-register details | Summary for one register session. | Native review required |
| `register.netSessionSales` | Net session sales | صافي مبيعات الجلسة | Closed-session primary KPI | Sales net of credit notes for the session. | Native review required |
| `register.posCashExpenses` | POS cash expenses | مصروفات نقطة البيع النقدية | Close-register reconciliation | Cash expenses recorded from the POS during the session. | Native review required |
| `register.cashRefunds` | Cash refunds | المبالغ النقدية المستردة | Close-register reconciliation | Cash portions of credit-note refunds. | Native review required |
| `register.dayClosing` | Day closing | إقفال اليوم | Day/session closing page | Accounting close for the day, not application logout. | Native review required |
| `pos.printer.connected` | Receipt printer connected | طابعة الإيصالات متصلة | POS printer-status control | Device status only; do not imply a successful print. | Native review required |
| `pos.zatca.success` | ZATCA submission successful | تم إرسال الفاتورة إلى ZATCA بنجاح | Background POS notification | Preserve ZATCA brand; status comes from existing routing. | Native review required |
| `documents.taxInvoice` | Tax Invoice | فاتورة ضريبية | A4 and thermal tax documents | Regulated tax-document term; requires qualified Saudi tax-domain review. | Native review required |
| `documents.simplifiedTaxInvoice` | Simplified Tax Invoice | فاتورة ضريبية مبسطة | B2C A4 and thermal documents | Regulated ZATCA term; do not shorten on legal documents. | Native review required |
| `documents.taxCreditNote` | Credit Note | إشعار دائن ضريبي | Credit-note documents | Review the tax qualifier and standard/simplified variants. | Native review required |
| `refunds.refund` | Refund | استرداد | Invoice detail and credit-note flow | Money returned to the customer. | Native review required |
| `creditNotes.returnQuantity` | Returned Quantity | كمية الإرجاع | Credit-note line entry | Quantity selected for the current return. | Native review required |
| `refunds.originalPayment` | Original Payment | الدفع الأصلي | Refund allocation summary | Must describe the historical tender without overwriting it. | Native review required |
| `refunds.refundIssued` | Refund Issued | المبلغ المسترد | Credit-note/refund history | Completed refund allocation, not the original tender. | Native review required |
| `documents.amountBeforeVat` | Amount Before VAT | المبلغ قبل الضريبة | Invoice totals | Keep distinct from taxable amount where both appear. | Native review required |
| `documents.vatAmount` | VAT Amount | مبلغ الضريبة | Invoice totals | Monetary VAT amount, not the rate. | Native review required |
| `documents.totalIncludingVat` | Total Including VAT | الإجمالي شامل الضريبة | Invoice totals | Final tax-inclusive document amount. | Native review required |
| `documents.seller` | Seller | البائع | A4 and thermal documents | Legal supplier/seller party. | Native review required |
| `documents.buyer` | Buyer | المشتري | Standard invoice documents | Legal buyer party. | Native review required |
| `documents.invoiceNumber` | Invoice Number | رقم الفاتورة | All invoice documents | Identifier must remain LTR and unchanged. | Native review required |
| `documents.paymentMethod` | Payment Method | طريقة الدفع | Invoice and receipt payment section | Describes the tender method. | Native review required |
| `refunds.cashAmount` | Cash Refund | مبلغ الاسترداد النقدي | Split-refund allocation | Cash portion actually returned. | Native review required |
| `refunds.cardAmount` | Card Refund | مبلغ الاسترداد إلى البطاقة | Split-refund allocation | Card portion actually returned. | Native review required |
| `refunds.split` | Split Refund | استرداد مقسّم | Refund method selector | One refund allocated between cash and card. | Native review required |
| `settings.invoiceSettings.documentLanguage` | Invoice document language | لغة مستندات الفواتير | Branch Invoice Settings | Independent from the authenticated interface language. | Native review required |
| `settings.invoiceSettings.bilingual` | Bilingual | ثنائي اللغة | Invoice language selector | Prints English and Arabic on the same document. | Native review required |
| `navigation.interfaceLanguage` | Interface language | لغة الواجهة | Authenticated sidebar | Changes Kubri UI only; never changes issued-document language. | Native review required |

## Review rules

- Review phrases in their actual screen, receipt, and invoice context rather than in isolation.
- Preserve merchant-entered Arabic and English exactly; do not machine-translate stored business data.
- Keep VAT numbers, invoice identifiers, SKUs, barcodes, phone numbers, email addresses, URLs, and QR payloads directionally isolated and unchanged.
- Validate regulated invoice and ZATCA terminology with a qualified Saudi tax-domain reviewer before approval.
- Record approval per key, including reviewer and review date, before moving a phrase into production translation resources.
