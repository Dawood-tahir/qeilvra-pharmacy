# POS prices, printing and returns

## Release requirement

Apply `supabase/migrations/202610190008_custom_sale_prices.sql` through your normal reviewed deployment process before deploying this application update. The user approved this function-only change for implementation and disposable local testing. It has **not** been applied to production. It replaces `private.checkout_units` without changing tables, signatures, grants or RLS policies.

An older database rejects changed prices instead of silently charging the catalogue price. Ordinary catalogue-priced checkout remains compatible.

## Counter workflow

- **Change Price** on a medicine card changes the selected selling unit for this sale; the cart uses the same price. Editing a cart price updates the matching card. Next sale clears these overrides. Permanent medicine prices are never updated.
- The transaction reads the authenticated role and the configured discount limit. For Salespeople, all price reductions plus the invoice discount share that limit, calculated against catalogue subtotal. Markups cannot cancel reductions to bypass the limit. Owners can authorize reductions beyond this limit; configured maximum unit prices still apply.
- Cash checkout requires enough cash and shows change. Card checkout requires the operator to confirm payment on an external terminal; the app records that confirmation and does not charge a card itself.
- The request UUID and exact payload are saved before checkout. Network failures retain that request and lock editing; **Retry Sale** retrieves the same transaction. A confirmed database rejection unlocks editing. Browser storage is required to start checkout safely.
- **Return / Refund** searches existing invoices using existing access rules. Salespeople can search their own invoices and request returns. Owners can review pending requests in the POS dialog or the existing Returns screen. Refund estimates use saved charged line amounts after invoice discounts. Approval remains the existing locked database transaction; it rejects excessive quantities and repeat approval. Stock is restored only when the Owner marks it suitable for resale, and the original batches are still sellable.
- Return submissions with uncertain outcomes must be checked in Returns before being submitted again. The return-request RPC has no idempotency-key argument; the app does not automatically retry it. Refund approval itself is protected against duplicate execution by the existing database transaction.

## Windows USB thermal printer

1. Install the printer manufacturer's Windows driver and confirm Windows can print a test page. Select the actual 58mm or 80mm roll in the driver's printing preferences and set a suitable receipt page length/cutter option for that printer.
2. In POS, choose **58mm** or **80mm** beside **Auto Print**. Both settings are stored in this browser profile on the device. They are independent of the staff account.
3. Print an existing invoice manually to configure the browser's destination, paper size, 100% scale, and disable browser headers/footers. The thermal layout reserves 2mm margins (54mm/76mm content). Browser/driver settings determine the physical paper size and cut length.
4. **Auto Print ON** opens the saved receipt only after checkout confirmation and requests printing once. Refreshing or revisiting that receipt in the same tab does not print it again. **OFF** leaves a **Print receipt** link after checkout. **Print invoice** on the receipt is an explicit reprint.
5. Cancelling the dialog does not undo or recreate the sale. Use the manual button to reprint. The app can request a print job but cannot verify that the printer produced paper. If browser storage is unavailable on the receipt page, automatic printing is suppressed and manual printing remains available.

Ordinary browsers show their print dialog. The app uses standard browser printing through the Windows driver; it does not require USB device access, printer SDKs or new dependencies.

## Optional silent printing on a dedicated counter

Chrome's `--kiosk-printing` switch automatically accepts print preview ([Chromium switch definition](https://github.com/chromium/chromium/blob/main/chrome/common/chrome_switches.h)). Use a dedicated, trusted POS browser profile:

1. Close that profile's Chrome windows. First launch it without kiosk printing, configure the thermal destination and paper settings using an existing receipt, then close it.
2. Create a Windows shortcut with a target similar to the following, substituting your POS URL and actual Chrome installation path:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\QeilvraChrome" --kiosk-printing --app="https://YOUR-POS-HOST/pos"
   ```

3. Open the shortcut and turn Auto Print ON. Check an existing receipt using the manual print button before using the counter. Keep general browsing out of this dedicated profile because the switch removes the print confirmation step.

Silent printing, printer drivers, paper feeding and cutters require testing on the target Windows device. No physical printer or silent kiosk session was available during automated verification.

## Verification scope

Local verification uses unit/API-boundary tests, Playwright's isolated UI harness, and disposable PostgreSQL databases that apply the real Supabase migrations and execute real stock/payment/refund transactions under Owner and Salesperson roles. The browser harness mocks Supabase responses and server actions; it is not a full Supabase HTTP end-to-end environment.

The Docker engine was unavailable, so full local Supabase Auth/PostgREST browser verification was not run. No production sales, refunds, schema changes or security policy changes were performed.
