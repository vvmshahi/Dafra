# Dafra UI refinement audit

## Scope and method

This audit covers the production `v1.5.0` source at commit `22f010d`. It is a
source-level review of every routed product area, the shared UI layer, English
and Arabic resources, print surfaces, and directly relevant regression tests.
No database, production data, deployment, or commercial calculation was
changed.

The representative widths for the follow-up manual pass are 360, 390, 768,
1024, 1280, and 1440 pixels. The current environment did not provide an
authenticated browser fixture for visual viewport capture, so findings that
depend on real content density or visual preference are explicitly registered
for screenshots rather than presented as visually verified facts.

This is not a formal WCAG conformance audit. It identifies concrete semantic,
keyboard, contrast-risk, motion, and responsive issues visible in the source.

## Product-specific design direction

Dafra is a daily merchant workspace for Saudi businesses. Its interface should
feel like a dependable counter ledger: calm forest green for structure,
emerald for confirmed actions, restrained gold for identity and attention, and
neutral surfaces for dense operational data. The recognizable element is the
document-grade treatment shared by invoices, receipts, reports, and money—not
decorative motion.

The existing palette and typography are retained:

- Forest structure: `#0F2419`
- Primary action: `#1B6B3A`
- Gold identity: `#C8A96E`
- Canvas: Gray 50 / white
- Error: Red 600–700
- English body: Inter/system sans
- Arabic body: local Noto Naskh Arabic through `KubriArabic`
- Numeric utility: tabular numerals and the local Saudi Riyal font

The refinement deliberately avoids a new visual signature or type system. A
larger visual change would conflict with the safe-foundation constraint and
requires screenshots from actual customer data.

## Complete route and component inventory

### 1. Authentication and onboarding

- Strengths: branded bilingual login, logical positioning, visible focus on
  primary links, responsive single-column fallback, localized recovery flows.
- Visual inconsistencies: the public/auth palette is warmer and more
  editorial than the application shell; this is defensible but needs a
  screenshot comparison before harmonizing.
- Usability: the “Remember me” checkbox has no local state or visible
  persistence explanation.
- Responsive: mobile layout is intentional; top back/language controls need
  real 360px validation with long Arabic labels.
- RTL: directional icons are handled through `DirectionalIcon`.
- Accessibility: login success/error feedback lacked explicit live semantics;
  this was corrected. Input IDs and descriptions are now generated safely.
- Terminology: the developer-style identifier example was replaced with
  merchant-facing localized copy.
- Risk: medium for visual/remember-me decisions; low for implemented semantics.
- Recommendation: validate the remember-me promise with the authentication
  persistence contract before retaining, explaining, or removing it.
- Disposition: safe semantics implemented; screenshot/behavior decision
  deferred.

### 2. Dashboard

- Strengths: role-specific owner and branch dashboards, strong status and
  summary hierarchy, clear cards and shortcuts.
- Visual inconsistencies: several one-off card hover elevations and gradient
  headers exist alongside the simpler shared card language.
- Usability: dashboard density depends heavily on live branch counts and
  business type.
- Responsive: responsive grids exist, but dense branch cards and action bands
  require populated screenshots at 768 and 1024px.
- RTL: most merchant names use `dir="auto"`; directional relationships need
  visual confirmation.
- Accessibility: loading skeletons are present; some clickable cards are
  custom interactive surfaces rather than shared buttons/links.
- Terminology: merchant-facing and localized.
- Risk: medium.
- Recommendation: do not normalize dashboard card composition without real
  owner/branch screenshots.
- Disposition: deferred for screenshots.

### 3. POS

- Strengths: highly optimized checkout workflow, scanner controls, clear
  payment states, logical CSS properties in newer sections, Piece/Carton
  identity, localized status feedback.
- Visual inconsistencies: many one-off buttons and modal patterns are required
  by the specialized workflow.
- Usability: the fixed 340px cart and product workspace work well on
  laptop/counter screens but produce a structural width conflict on narrow
  phones.
- Responsive: the product grid responds, while the two-panel checkout shell
  does not provide a deliberate mobile cart transition.
- RTL: newer search/cart positioning is logical; mixed number/currency
  isolation is generally strong.
- Accessibility: many buttons have names, but modal focus behavior is not
  consistently shared across every POS modal; several quantity targets are
  smaller than 40px.
- Terminology: legally and commercially sensitive copy is localized and should
  not be casually renamed.
- Risk: high.
- Recommendation: decide whether phone POS is supported; if yes, design a
  product/cart step or bottom-sheet model from screenshots and real hardware.
- Disposition: no structural POS change in this phase.

### 4. Products, product units, and barcode drawer

- Strengths: grid/list views, category filters, unit management, barcode batch
  printing, persistent UI drafts, clear availability state.
- Visual inconsistencies: header/actions and state presentation were locally
  composed; now use shared foundations.
- Usability: four header actions can be dense on mobile.
- Responsive: actions now wrap consistently; search uses logical padding;
  category scrolling remains available.
- RTL: product-card corner positioning and search controls were converted to
  logical start/end placement. View controls now have accessible localized
  names.
- Accessibility: view toggles now expose `aria-pressed`; search/clear controls
  have names.
- Terminology: Piece/Carton and POS availability remain unchanged.
- Risk: low for implemented changes; medium for action prioritization.
- Recommendation: use a screenshot to decide whether secondary product actions
  should move into an overflow menu below 390px.
- Disposition: foundational changes implemented; action prioritization
  deferred.

### 5. Customers

- Strengths: clear type filters, intelligence detail/report paths, mobile-aware
  row information, merchant-facing empty copy.
- Visual inconsistencies: page header and state composition were duplicated.
- Usability: delete still uses the browser confirmation rather than the shared
  confirmation pattern.
- Responsive: header actions wrap; search uses logical spacing.
- RTL: mixed names use automatic direction; search icon/clear placement is now
  logical.
- Accessibility: shared state semantics and named search controls added.
- Terminology: customer types are clear in both languages.
- Risk: low for implemented changes; medium for confirmation migration.
- Recommendation: migrate deletion only after confirming the desired
  reversible/archive language.
- Disposition: safe foundations implemented.

### 6. Customer detail and Customer Reports

- Strengths: server-authoritative data, bounded pagination, desktop table plus
  mobile cards, accessible sort controls, RTL PDF.
- Visual inconsistencies: detail/report use a denser intelligence language than
  simple CRUD pages, appropriately.
- Usability: filter volume is high but structured.
- Responsive: shared filter panel now supplies consistent responsive grids and
  horizontally scrollable presets.
- RTL: logical positioning and localized names are present.
- Accessibility: table headings, live states, and filter labels are present.
- Terminology: gross/net/credit language follows server definitions and was not
  changed.
- Risk: low.
- Recommendation: validate 360/390px filter height and long Arabic result cards
  with data.
- Disposition: shared filter foundation implemented.

### 7. Suppliers

- Strengths: summary, range context, detail/report navigation, soft
  deactivation, informative purchase totals.
- Visual inconsistencies: header and empty/loading states were locally
  composed.
- Usability: action hierarchy now consistently presents reporting as secondary
  and adding as primary.
- Responsive: one-column summary fallback and wrapped actions are retained.
- RTL: search icon and input padding now use logical properties.
- Accessibility: shared loading/empty semantics and named search input added.
- Terminology: supplier purchase relationships remain merchant-facing.
- Risk: low.
- Recommendation: validate long supplier names and three-card summaries at
  360px.
- Disposition: safe foundations implemented.

### 8. Supplier detail and Supplier Reports

- Strengths: bounded history, accessible timeline, server filters, mobile
  cards, RTL PDF, explicit non-payables disclaimer.
- Visual inconsistencies: supplier amber accent intentionally differentiates
  supply-side intelligence.
- Usability: information density is high but the hierarchy is explicit.
- Responsive: shared six-column filter grid now resolves through one, two,
  three, then six columns.
- RTL: names and monetary values are isolated correctly.
- Accessibility: labels, table headers, and non-color trend explanations exist.
- Terminology: payment state remains informational; no payable semantics.
- Risk: low.
- Recommendation: screenshot-check six filter fields and timeline labels in
  Arabic at tablet width.
- Disposition: shared filter foundation implemented.

### 9. Purchases and receiving

- Strengths: purchase/receiving boundaries are explicit and stock behavior is
  gated by business configuration.
- Visual inconsistencies: the route header differed from related CRUD pages.
- Usability: purchase history owns multiple nested detail/reversal dialogs.
- Responsive: shared header now provides stable title/description spacing.
- RTL: core fields use localized labels, while several historical modal
  layouts still need visual validation.
- Accessibility: multiple custom dialogs do not share a common focus contract.
- Terminology: receiving versus purchase-bill language is commercially
  sensitive and unchanged.
- Risk: high for modal/receiving changes; low for header.
- Recommendation: screenshot and keyboard-test every purchase-history modal
  before consolidating dialog infrastructure.
- Disposition: header only implemented.

### 10. Stock and inventory

- Strengths: business-type gating, separate product/material views, clear
  disabled-state guidance.
- Visual inconsistencies: header/subtitle spacing was manually split.
- Usability: disabled state gives a direct purchase route.
- Responsive: shared header improves compact spacing.
- RTL: logical direction is broadly used in newer receipt drawers.
- Accessibility: tab controls remain ordinary named buttons; custom drawers
  need focused keyboard testing.
- Terminology: “Stock” is consistent; no stock behavior changed.
- Risk: high for workflow changes; low for header.
- Recommendation: validate drawer width and unit fields at 360/390px.
- Disposition: header only implemented.

### 11. Invoices and credit notes

- Strengths: strong document hierarchy, responsive summary cards, safe invoice
  read surfaces, clear ZATCA status, print models, accessible table headers.
- Visual inconsistencies: intentionally more formal header scale than CRUD
  lists.
- Usability: retry actions and compliance states are prominent.
- Responsive: table and filter density need populated 768px validation.
- RTL: document numbers, dates, money, and legal identity are isolated.
- Accessibility: credit-note modal is complex and needs full focus-cycle
  testing; several dialogs are custom.
- Terminology: legally significant; unchanged.
- Risk: high.
- Recommendation: no copy or structure changes without document screenshots
  and compliance review.
- Disposition: audit only.

### 12. Reports navigation

- Strengths: established tabs, bounded backend data, PDF infrastructure.
- Visual inconsistencies: top-level header was custom; now shared.
- Usability: seven tabs create horizontal scanning at small widths.
- Responsive: tab strip scrolls; branch selector now uses logical auto margin.
- RTL: tab content localizes, but order preference needs screenshot validation.
- Accessibility: top-level actions have clear focus and minimum height.
- Terminology: “Profit Estimate” and “VAT Support” correctly avoid overstating
  accounting authority.
- Risk: medium.
- Recommendation: decide from screenshots whether report categories need
  grouping rather than a single strip.
- Disposition: safe header/RTL refinement implemented.

### 13. Printing & Documents

- Strengths: clear workspace categories, branch-shared settings, responsive
  two/four-column navigation, live document previews, local fonts.
- Visual inconsistencies: the outer workspace is polished, while the embedded
  V1 invoice appearance editor uses a separate dense visual/copy layer.
- Usability: shared versus device-local boundaries are present but distributed
  across Printing & Documents and Device Printer.
- Responsive: workspace tabs adapt; print previews require real tablet capture.
- RTL: outer workspace is localized; the embedded V1 invoice appearance editor
  contains extensive English-only copy.
- Accessibility: outer tabs have names and focus; embedded editor semantics are
  partial.
- Terminology: invoice appearance contains legally adjacent language and is
  protected by focused compatibility tests.
- Risk: high.
- Recommendation: localize the complete V1 editor as a dedicated, reviewed
  change, preserving literal compatibility markers or updating tests with the
  same release.
- Disposition: documented, not bulk-rewritten.

### 14. Business and branch settings

- Strengths: branch management clearly separates identity, operational state,
  VAT/ZATCA notices, and business type.
- Visual inconsistencies: branch management uses a branded hero while account
  settings use a compact tab layout.
- Usability: the separation reflects different risk levels but can feel like
  multiple settings products.
- Responsive: grids and drawers exist; branch cards need populated tablet
  screenshots.
- RTL: translations are extensive; long official names need capture.
- Accessibility: custom branch drawers/dialogs do not all share one focus
  implementation.
- Terminology: generally merchant-facing; legally sensitive official identity
  remains separate.
- Risk: high.
- Recommendation: retain routes, then use screenshot navigation testing before
  combining categories.
- Disposition: audit only.

### 15. Users and access

- Strengths: role and branch assignment are visible, active state uses a named
  switch, bilingual names supported.
- Visual inconsistencies: the employee drawer uses raw layout primitives.
- Usability: required fields are marked, but there is no unified error summary.
- Responsive: two-column fields collapse insufficiently at the smallest width
  in some drawer sections.
- RTL: Arabic name field is explicitly RTL; mixed role data needs screenshots.
- Accessibility: drawer lacks shared dialog semantics, focus trapping, and
  restoration.
- Terminology: “Employees” and role names are localized.
- Risk: high because access changes are consequential.
- Recommendation: keyboard-test and then migrate the drawer shell without
  changing save behavior.
- Disposition: deferred.

### 16. Settings information architecture

- Strengths: account/subscription/device persistence is already separated;
  business type is visibly read-only.
- Visual inconsistencies: no page title previously framed the tabs.
- Usability: page title/description and active-state semantics were added.
- Responsive: tabs remain horizontally scrollable with 40px minimum height.
- RTL: tab labels and descriptions localize.
- Accessibility: tab buttons now expose `aria-pressed`; content has a named
  live section.
- Terminology: added localized account/subscription/device framing without
  database terms.
- Risk: low.
- Recommendation: do not merge branch, printing, ZATCA, and account settings
  until navigation screenshots establish customer expectations.
- Disposition: safe hierarchy implemented.

### 17. Dialogs, drawers, confirmations, toasts, and alerts

- Strengths: Sonner provides cohesive toasts; newer barcode dialogs include
  mobile-sheet behavior and modal semantics.
- Visual inconsistencies: many routes implement independent overlays, widths,
  headers, and button rows.
- Usability: backdrop/Escape behavior varies.
- Responsive: barcode dialogs are the strongest mobile reference; older
  drawers need 360px checks.
- RTL: action order and close icon placement vary by implementation.
- Accessibility: the shared `ConfirmDialog` now traps focus, starts on the safe
  action, supports Escape, locks background scrolling, and restores focus.
  Many legacy custom dialogs remain outside that shared contract.
- Terminology: destructive confirmation language varies between delete,
  deactivate, archive, and remove.
- Risk: high for broad migration; low for shared confirmation fix.
- Recommendation: migrate one workflow family at a time after manual keyboard
  tests.
- Disposition: shared foundation implemented; legacy consolidation deferred.

### 18. Mobile navigation and application shell

- Strengths: compact sidebar mode preserves all routes and role filtering.
- Visual inconsistencies: mobile uses a persistent 64px icon rail instead of a
  phone-native drawer or bottom navigation.
- Usability: reliable but leaves limited content width at 360px.
- Responsive: content padding now reduces from 24px to 16px on small screens;
  subscription banners wrap safely.
- RTL: application content changes direction while the rail remains
  structurally stable; labels use RTL when expanded.
- Accessibility: a localized skip link and named main navigation were added;
  navigation links now show explicit keyboard focus.
- Terminology: section names are localized.
- Risk: medium.
- Recommendation: decide whether the icon rail is the desired phone pattern
  from screenshots before replacing it.
- Disposition: safe shell improvements implemented.

### 19. Arabic and mixed-direction presentation

- Strengths: document surfaces use local Arabic fonts, `dir="auto"`, `bdi`,
  and logical properties extensively.
- Visual inconsistencies: older search controls and card corners used physical
  left/right positioning.
- Usability: phone, VAT, barcode, date, and money fields generally preserve LTR
  reading.
- Responsive: Arabic strings may be materially longer than English.
- RTL: prominent product/customer/supplier search and product-card positions
  were converted to logical properties. Device Printer now uses a directional
  icon wrapper. Switch geometry is isolated from inherited direction.
- Accessibility: language switching is named and keyboard accessible.
- Terminology: English/Arabic resource parity is protected by the new test.
- Risk: low for implemented changes; medium for screenshot-only wrapping.
- Recommendation: capture long Arabic names at every target width.
- Disposition: safe logical-property fixes implemented.

### 20. Loading, empty, success, warning, and error states

- Strengths: most feature areas already distinguish these states and avoid raw
  database errors.
- Visual inconsistencies: spacing, icons, card/no-card presentation, and live
  semantics were repeated.
- Usability: guidance is generally actionable.
- Responsive: state copy must wrap rather than truncate.
- RTL: automatic wrapping works when direction is inherited.
- Accessibility: shared `ContentState` now centralizes loading/empty/error live
  behavior; customer and supplier lists use it. Login feedback is announced.
  Skeleton primitives are hidden from the accessibility tree.
- Terminology: generic support guidance remains localized.
- Risk: low.
- Recommendation: adopt the shared state incrementally when each route is next
  touched rather than mechanically rewriting all states now.
- Disposition: foundational component and two representative adoptions
  implemented.

## Design-system audit

### Existing strengths

- A coherent forest/emerald/gold identity.
- Reusable `.btn`, `.input`, `.card`, `.badge`, skeleton, spinner, switch, and
  Riyal primitives.
- Strong local print typography and document-specific layout systems.
- Consistent 12–16px radii and low-elevation card shadows.
- Tailwind breakpoints are used consistently.

### Conflicts and duplication

- Page headers ranged from compact `text-lg` rows to branded heroes and formal
  `text-2xl` report/document headers.
- Filter shells and date preset scrollers were duplicated between intelligence
  areas.
- 326 raw `<button>` elements versus 118 shared `<Button>` usages reflect many
  specialized controls but also inconsistent focus/press behavior.
- Numerous custom modal/drawer shells coexist with the shared confirmation.
- `transition-all` appears in frequent operational controls.
- Older routes use physical `left/right/margin-left/padding-left` utilities.
- Some table-like lists use div rows while newer intelligence pages provide a
  true table plus mobile cards.
- No dark-mode token set exists; dark mode is not currently a supported product
  mode.

## Safe implementation review

| Before | After | Why |
| --- | --- | --- |
| Repeated route-specific title/action rows | Shared `PageHeader` on eight operational routes | Keeps hierarchy and wrapping consistent without changing route behavior |
| Duplicate customer/supplier intelligence filter shells | Shared `FilterPanel`, preset scroller, and responsive grid | One responsive/accessible behavior for equivalent controls |
| Local customer/supplier loading and empty markup | Shared `ContentState` | Gives state copy consistent semantics and wrapping |
| Input IDs derived from translated label text | Stable `useId` IDs with `aria-describedby` and `aria-invalid` | Prevents duplicate/invalid IDs and connects help/error copy |
| Confirmation dialog did not manage focus | Safe initial focus, Tab loop, Escape, scroll lock, focus restoration | Prevents keyboard escape from the modal and accidental destructive focus |
| `transition-all` in shared buttons/inputs | Explicit property transitions and subtle press feedback | Reduces unintended animation and improves response |
| No global reduced-motion handling | `prefers-reduced-motion` override | Removes layout motion for users who request it |
| Fixed 24px application content padding | 16px mobile / 24px larger padding | Recovers scarce width on 360/390px screens |
| Subscription banners assumed one line | Wrapping message/action layout | Prevents long Arabic copy from colliding |
| No skip link or named main navigation | Localized skip link, main target, and navigation label | Improves keyboard navigation |
| Physical search/card positioning | Logical start/end utilities on prominent CRUD routes | Correct placement in English and Arabic |
| Unnamed product view toggles | Localized names and `aria-pressed` state | Makes icon-only controls understandable |
| Developer-style login identifier example | Localized merchant-facing placeholder | Removes internal vocabulary |
| Settings opened directly on tabs | Shared page title/description and active-state semantics | Clarifies the page’s scope |

## Table and list findings

- Intelligence reports already provide the preferred model: semantic desktop
  table, mobile card fallback, stable pagination, long-name wrapping, and
  numeric alignment.
- Customer/supplier/product lists use responsive div rows or grids. They remain
  usable but should not be mechanically converted because action priority and
  visible fields need screenshots.
- Invoice and report tables use intentional horizontal scrolling when essential
  columns cannot be removed.
- Currency presentation consistently uses `Rial`/`RiyalSymbol` in current
  operational surfaces; no alternative currency component was introduced.
- Piece and Carton labels remain driven by immutable unit/localization data.

## Form and dialog findings

- Shared `Input` now provides robust label/help/error relationships.
- Shared buttons retain the existing hierarchy while adding explicit
  transitions and press feedback.
- The shared confirmation is now keyboard-contained.
- Broad modal consolidation is unsafe in this phase: barcode, POS, credit-note,
  purchasing, employee, branch, and invoice-settings dialogs have different
  behavioral contracts.
- Required indicators and inline validation exist, but error summaries are not
  standardized across every long form.

## Settings architecture map

- Owner account/subscription: `/settings`
- Branch/business management: `/branches`
- Users/access: `/employees`
- Official seller/ZATCA: `/settings/official-seller` and `/zatca` where enabled
- Branch-shared receipts/invoices/barcode defaults: `/invoice-settings`
- Device-local printer: `/device-printer` and Electron-only printer panel
- Interface language: authenticated sidebar language switch

This separation accurately reflects persistence boundaries. The UI needs
stronger cross-navigation and explanation, but persistence semantics should not
be changed merely to make settings appear consolidated.

## Performance and motion

- No new framework or dependency was added.
- Shared components are small React/CSS primitives.
- Reduced-motion support applies globally.
- Shared control transitions now name properties instead of using
  `transition-all`.
- Existing page/data loading, pagination, PDF, barcode, POS, and reporting paths
  are unchanged.

## Testing implications

The automated refinement test should assert shared component adoption,
localization parity, logical RTL properties, focus management, state semantics,
route preservation, and compatibility markers for printing, intelligence,
barcode, purchasing, POS, invoices, and credit notes. Visual decisions remain
in the screenshot register.
