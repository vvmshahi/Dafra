# UI screenshot follow-up register

This register contains decisions that should not be guessed from source alone.
Screenshots should use realistic long English and Arabic content and, where
relevant, Owner and Branch User roles.

| Route | Component | Screenshot required | Exact user decision needed | Severity | Suggested solution | Likely files |
| --- | --- | --- | --- | --- | --- | --- |
| `/pos` | Product/cart shell | 360, 390, 768px with a populated cart | Is phone checkout supported, and should cart become a second step or bottom sheet? | High | Choose a deliberate product→cart mobile flow | `POSPage.tsx` |
| Application shell | Collapsed sidebar | 360 and 390px, EN/AR | Keep the 64px icon rail, use a drawer, or use bottom navigation? | High | Preserve role filtering inside the selected mobile pattern | `AppLayout.tsx`, `Sidebar.tsx` |
| `/invoice-settings` | V1 invoice appearance editor | 390, 768, 1024px in Arabic | Approve complete Arabic terminology and whether section names should be shortened | High | Dedicated localization pass that updates focused compatibility tests | `InvoiceSettingsPage.tsx`, `settings.json` |
| `/invoice-settings` | Settings versus preview | 390 and 768px with long footer/logo | Is the current two-button mobile pane switch understandable? | Medium | Refine pane labels/sticky controls after capture | `InvoiceSettingsPage.tsx` |
| `/products` | Header actions | 360 and 390px | Which of Categories, Add Category, Batch Print, and Add Product stay visible? | Medium | Move lower-priority actions into a labelled overflow menu if needed | `ProductsPage.tsx` |
| `/products` | Grid/list cards | 360, 768px with long bilingual names | Prefer truncation, two-line clamp, or full wrapping? | Medium | Pick one name policy per view | `ProductsPage.tsx` |
| `/customers` | Responsive row | 360/390px with business customer | Which secondary identifiers must remain visible on phone? | Medium | Design a true mobile card only after priority is confirmed | `CustomersPage.tsx` |
| `/suppliers` | Summary and row | 360/390px with long Arabic supplier | Should three summary cards remain stacked or become a horizontal scroller? | Medium | Keep stacking unless screenshots show excessive height | `SuppliersPage.tsx` |
| `/reports` | Seven-tab navigation | 390 and 768px | Keep one scrolling strip or group reports by purpose? | Medium | Use two-level grouping only with user approval | `ReportsPage.tsx` |
| `/reports/customers` | Filter panel and mobile cards | 390/768px Arabic | Is filter density acceptable before results? | Medium | Consider collapsible secondary filters if needed | `CustomerIntelligenceReportsPage.tsx`, `CustomerIntelligenceFilters.tsx` |
| `/reports/suppliers` | Six-field filters and timeline | 390/768px Arabic | Is the informational payment field sufficiently clear? | Medium | Adjust helper placement/collapse only after capture | `SupplierIntelligenceReportsPage.tsx`, `SupplierIntelligenceFilters.tsx` |
| `/dashboard` | Owner branch cards | 768, 1024, 1440px with 10+ branches | Is card density or table density preferred at scale? | Medium | Choose card/table switch from real branch data | `DashboardPage.tsx` |
| `/branch` | Branch dashboard shortcuts | 360, 768, 1024px | Which daily actions deserve first-screen priority? | Medium | Reorder only after merchant usage decision | `BranchDashboardPage.tsx` |
| `/branches` | Branded hero and branch cards | 390/768px Arabic | Does the hero consume too much operational space? | Low | Compact it only if screenshots show excessive scroll | `BranchesPage.tsx`, `BranchesTab.tsx` |
| `/employees` | Employee drawer | 360/390px Arabic | Should fields remain single-column on phone, and what is the preferred destructive action? | High | Adopt a shared drawer shell after keyboard testing | `EmployeesPage.tsx` |
| `/purchases` | Purchase history dialogs | 390/768px with Piece/Carton rows | Which columns and actions are essential on phone? | High | Design mobile receipt cards without changing receiving logic | `PurchaseHistoryTab.tsx`, `PurchaseDrawer.tsx` |
| `/invoices` | Table/filter area | 768/1024px with long ZATCA states | Is horizontal scroll acceptable or should secondary status move into details? | High | Retain all legal/commercial meaning while reducing width | `InvoicesPage.tsx` |
| Credit-note flow | Modal and receipt state | 390/768px English/Arabic | Is action hierarchy clear at each legally significant step? | High | Adjust layout only with invoice identity tests open | `CreateCreditNoteModal.tsx`, `AtomicCreditNoteReceiptView.tsx` |
| Barcode batch print | Drawer/designer/calibration | 390, 768, 1024px and print preview | Are advanced controls understandable to first-time merchants? | Medium | Progressive disclosure if screenshots confirm overload | `BarcodeBatchPrintDrawer.tsx`, barcode components |
| Authentication | Login top controls and form | 360/390px Arabic | Should “Remember me” remain, be explained, or be removed? | Medium | Align the control with the actual Supabase session contract | `LoginPage.tsx` |
| Global | Status colors | Representative success/warning/error screenshots | Are current amber/red/emerald contrasts acceptable on target displays? | Medium | Measure contrast on rendered colors before token changes | `tailwind.config.js`, route components |
| Global | Dark mode | Full product decision | Is dark mode part of initial-customer scope? | Low | Do not add partial dark mode; define complete tokens if approved | `tailwind.config.js`, `index.css`, all surfaces |

## Screenshot capture content

For each applicable route, include:

- 360, 390, 768, 1024, 1280, and 1440px widths.
- English and Arabic.
- One short and one unusually long bilingual name.
- Empty, populated, loading, and error states where reproducible.
- Owner and Branch User scope.
- Keyboard focus visible on the primary action.
- Piece and Carton rows where units appear.
- Riyal values with four, six, and eight digits.

Print-specific captures should also include multi-page A4, 58mm/80mm thermal,
barcode A4 sheets, and the browser Save as PDF dialog where available.
