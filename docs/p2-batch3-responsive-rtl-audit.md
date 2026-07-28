# P2 Batch 3 responsive and RTL audit

## Route summary

| Route | Responsive decision | State / RTL result |
| --- | --- | --- |
| `/branch` | KPI cards remain 1/2/4 columns with reduced gaps and short-height density; recent invoices keep an explicitly labelled scroll region | Existing loading, retry, empty, caution, and New Sale states retained |
| `/pos` | Existing workspace-specific responsive layout retained | Directional close control changed to logical `end` |
| `/invoices` | Existing desktop table plus mobile cards retained | Essential document number, customer, date, total, status, and actions remain |
| `/products` | Existing compact list/grid adaptation retained | Name, SKU/barcode, price, stock/status, and named actions remain |
| `/inventory` | Existing compact product/material rows retained | Materials editor remains centered; one physical margin changed to logical spacing |
| `/purchases` | Added mobile cards below 768px; desktop table retained | Supplier/reference, date, total, payment/status, bill/details and mutation actions remain |
| `/suppliers` | Existing compact row retained | Secondary columns hide progressively; identity and named actions remain |
| `/customers` | Existing compact row retained | Identity, mobile/type readiness context, and named actions remain |
| `/expenses` | Existing compact row retained | Search/filter/input adornments now use logical positioning |
| `/invoice-settings` | Editor/preview split now begins at 1280px instead of 1024px | Existing mobile pane switch and sticky controls retained |
| `/reports` | Tabs remain a labelled horizontal region; filters stack on mobile | Arrow navigation follows document direction and selected tabs scroll into view |
| `/profile` | Existing responsive form retained | Input icons and password reveal controls now use logical start/end spacing |

## Intentionally physical positioning

- App modal overlays retain `md:left-[var(--app-sidebar-width)]` because the authenticated shell deliberately keeps its sidebar on the physical left while only the content direction changes.
- Recharts margins and chart axes remain physical coordinate geometry.
- PDF, receipt, A4, and barcode margin/offset calculations remain physical print geometry.
- Centering transforms such as `left-1/2 -translate-x-1/2` remain physical visual centering.
- Camera/scanner and print-only `left: 0` coordinates remain unchanged.
- Public landing/auth decorative positioning is outside the authenticated workspace and remains visual geometry.

## Deferred P3 work

- Route-level lazy loading and bundle splitting.
- Server pagination or query redesign for very large tables.
- A new global overflow-action menu or mobile navigation architecture.
- Broad design-system component decomposition.
