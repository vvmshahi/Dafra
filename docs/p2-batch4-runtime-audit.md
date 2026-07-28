# P2 Batch 4 runtime audit

## Test infrastructure decision

The repository has no Playwright, Cypress, Vitest, Jest, or React Testing Library setup. It already ships JSDOM and Vite, so Batch 4 uses a dependency-free mounted React harness: Vite transforms the production TSX modules and JSDOM supplies the DOM. Run it with:

```sh
npm run test:p2-batch4-runtime
```

The runner fails on unexpected `console.error` or `console.warn` output and closes the Vite server and DOM after every run.

## Automated runtime coverage

- Shared `ConfirmDialog`: accessible name/description, initial safe focus, Tab and Shift+Tab wrap, Escape, confirm, body scroll lock/restoration, exact trigger focus restoration, disabled busy actions, and busy Escape suppression.
- Reports tablist: mounted production tab component, click/selection state, roving tab index, focus movement, Home/End, LTR arrows, and reversed RTL arrows.
- Authenticated language switch: mounted production switch, English/Arabic transitions, document `lang`/`dir`, target-language attributes, and focus retention.
- Customer/supplier archive response verification: exact returned ID, one success request, and rejection of network errors, empty success bodies, mismatched IDs, and non-2xx statuses. Both pages use the tested shared verifier.
- Console cleanliness and teardown are enforced by the runtime runner.

## Browser-only manual matrix

JSDOM cannot calculate layout, paint sticky regions, invoke a native print preview, or prove real pointer occlusion. Before release, perform this matrix in a real Chromium browser at 100% zoom:

| Surface | Viewports | Checks |
| --- | --- | --- |
| Shell/sidebar | 1440×900, 1024×768, 390×844, 844×390, 1280×600 | active item visible after route changes; nav scrolls independently; compact footer does not cover nav; mobile drawer backdrop blocks the page; Escape/close restores trigger focus |
| Product, stock, purchases, customers, suppliers, expenses | 390×844, 844×390, 1280×600 | no clipped primary action; table/card mode remains usable; filters wrap or scroll; modal body scrolls while actions remain reachable |
| Reports | 390×844, 844×390, 1280×600 | tab strip scrolls without page overflow; active tab scrolls into view; filters and export action do not overlap; report content remains readable |
| Arabic RTL | all viewports above | sidebar/drawer opens from logical side; arrows follow visual direction; start/end alignment is logical; mixed Arabic/English text is readable; no mirrored product glyphs |
| Printing | A4 and thermal preview, print dialog | controls are absent from print output; page margins are correct; no clipped totals, QR, footer, or receipt content; repeated print does not retain stale preview state |
| Sequential overlays | desktop and mobile | open/close two different drawers/dialogs in sequence; no stale backdrop, body lock, focus trap, or document listener remains |

For mutation surfaces, throttle the network and exercise success, server error, and double-click paths. Confirm that pending controls disable, failure retains entered values/source rows, success closes and refreshes, and no false success toast appears.

## Deliberate scope

No backend, Supabase migration, RPC, schema, generated type, Electron, or deployment files are changed. The only production refactors expose the existing report tablist as a testable component and share the already-present exact-response customer/supplier archive check.
