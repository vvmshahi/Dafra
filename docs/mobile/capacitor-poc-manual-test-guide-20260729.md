# Kubri Mobile POC manual test guide

All displayed business data is local fixture data. Do not configure production credentials.

## Browser preview

1. Run `cd apps/mobile && npm install && npm run dev`.
2. Open `http://127.0.0.1:5186` at 320, 390, 430 and 768 pixel widths.
3. Confirm splash, sign-in, fixture warning and role chooser render.
4. Choose Owner/Admin. Exercise all five tabs, branch detail, report cards, activity and read-only ZATCA status.
5. Return to role selection by reloading. Choose Branch.
6. Search products by English name and barcode.
7. Add products, open the cart dock, update quantity, select a customer, and open the simulated checkout.
8. Confirm every result says simulation/preview and never claims a server invoice.
9. Exercise Share; browsers may use their supported share fallback.
10. Switch English/Arabic and confirm document direction changes.
11. Use keyboard-only navigation and a screen reader; verify visible focus and meaningful control labels.
12. Disable the network in browser tools. Confirm the warning appears and checkout is disabled.
13. Re-enable the network. Confirm revalidation messaging appears before checkout becomes available.

## Native follow-up

1. Install JDK and the Android Studio/SDK versions required by Capacitor 8.
2. Set the SDK through Android Studio, start an emulator or connect a device, and confirm `adb devices`.
3. Run `npm run cap:sync`, then `npm run android:run`.
4. Validate cold launch, safe areas, Android Back, background/resume and keyboard behavior.
5. Test camera grant, denial, permanent denial, unavailable camera, unknown barcode, out-of-stock barcode and rapid duplicate scan.
6. Test native share on a real device without selecting a real customer.
7. Do not test production checkout.

iOS later requires full Xcode. Run `npm run cap:sync` and `npm run ios:open`, then validate the equivalent camera, share, safe-area and lifecycle cases without signing or submission.
