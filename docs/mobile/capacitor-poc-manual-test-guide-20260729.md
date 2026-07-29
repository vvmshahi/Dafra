# Kubri Branch mobile redesign manual test guide

Use safe fixture data for visual review. Do not configure production credentials or issue a production invoice.

## Browser preview

1. Run `cd apps/mobile && npm install && npm run dev`.
2. Open `http://127.0.0.1:5186` at 320, 390, 430 and 768 pixel widths.
3. Confirm the Kubri splash and production-style sign-in render with no POC wording.
4. Build with `VITE_MOBILE_DEMO_MODE=true` only for fixture review, then open the development fixture.
5. Confirm the Branch bottom navigation contains exactly Home, New Sale and Invoices.
6. Search products by English name and barcode.
7. Add products, open the cart dock, update quantity, select a customer, and open the simulated checkout.
8. Confirm every result says simulation/preview and never claims a server invoice.
9. Exercise Share; browsers may use their supported share fallback.
10. Switch English/Arabic and confirm document direction changes.
11. Use keyboard-only navigation and a screen reader; verify visible focus and meaningful control labels.
12. Disable the network in browser tools. Confirm the warning appears and checkout is disabled.
13. Re-enable the network. A future production checkout integration must reconcile server state before another attempt; this fixture does not queue work.

## Native follow-up

1. Install JDK and the Android Studio/SDK versions required by Capacitor 8.
2. Set the SDK through Android Studio, start an emulator or connect a device, and confirm `adb devices`.
3. For fixture review run `VITE_MOBILE_DEMO_MODE=true npm run build`, `npx cap sync android`, then assemble/install the debug APK.
4. Confirm the Kubri launcher icon, native splash, web splash, safe areas, Android Back, background/resume and keyboard behavior.
5. Test camera grant, denial, permanent denial, unavailable camera, unknown barcode, out-of-stock barcode and rapid duplicate scan.
6. Test native share on a real device without selecting a real customer.
7. Exercise Home, drawer, New Sale, cart/payment simulation, success actions and Invoices in both English and Arabic/RTL.
8. Confirm offline mode retains the unsent cart but blocks payment and never queues an invoice.
9. Do not test production checkout, real customer data or production credentials.

## Production-connected read-only build

1. Configure only the public values from `apps/mobile/.env.example`; keep local values ignored.
2. Set `VITE_MOBILE_ACCESS_MODE=read-only`, `VITE_MOBILE_PRODUCTION_CHECKOUT=false`, and `VITE_MOBILE_DEMO_MODE=false`.
3. Install the APK and confirm sign-in is enabled and no fixture bypass appears.
4. The authorised user types credentials directly on the phone. Never record the screen while entering credentials.
5. Compare Owner/Branch KPIs with the web workspace for the same Riyadh date and Branch.
6. Verify products, exact barcode resolution, customers, invoices, register state, resume, logout and Arabic/RTL.
7. Stop before any register, product, customer, stock, return or checkout mutation unless the exact tenant and Branch have separate explicit approval.

iOS later requires full Xcode. Run `npm run cap:sync` and `npm run ios:open`, then validate the equivalent camera, share, safe-area and lifecycle cases without signing or submission.
