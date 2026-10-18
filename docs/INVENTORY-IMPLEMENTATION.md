# Inventory/POS implementation and rollout

Updated 18 October 2026. See [the initial audit](INVENTORY-AUDIT.md).

## Delivered

- Inventory has separate **Add New Medicine** and **Add More Stock** actions, search, sorting, paginated low-stock/expiry/review filters, human-readable packaging and mobile cards.
- New medicine uses three focused steps, live stock conversion, confirmed packaging, independent unit prices, optional legal/MRP limits and a review before saving. The initial purchase and batch are committed with the medicine.
- Restocking reuses confirmed packaging and prices. It previews the resulting available stock and records a separate purchase receipt and expiry.
- POS selects tablet/capsule, strip, box or a whole sealed item, keeps distinct mixed-unit lines, enforces the combined stock requirement, and prints the original unit, quantity and charged price. Cart state survives refresh within the same browser session and is scoped to the signed-in staff ID.
- Checkout uses database prices, integer physical quantities, FEFO, medicine/batch locks, price snapshots and idempotent retries. Unknown transport outcomes retain the exact request until its result can be confirmed.
- Purchases convert the selected purchased unit once and allocate invoice discounts into batch cost. Returns track original batch allocations across partial returns; discounted line snapshots avoid rounding over-refunds. Non-saleable returns retain their inventory loss.
- Owner stock correction asks for a physical count, reviews the change, and rejects stale balances. This also resolves legacy fractional stock through an explicit audited count.
- Owner price, stock and profit operations are enforced by PostgreSQL permissions/RLS and authenticated RPCs. There remain exactly two roles. No customer module or production framework was added. Shell prefetching is disabled within POS to avoid background dashboard/report requests.

## Three additive migrations

Apply in order after the existing four migrations:

1. `202610180005_packaging_and_workflows.sql`: packaging status, allowed selling units/prices/limits, receipt idempotency, invoice conversion and net-price snapshots, private transaction helpers, validated public invoker entry points and whole-stock safeguards.
2. `202610180006_receipts_and_returns.sql`: independent purchase receipts, original return allocations, accurate COGS/refunds and reports.
3. `202610180007_purchase_units.sql`: supplier-purchase unit conversion and safe physical stock counts.

No historical balances are multiplied, rounded or relabelled. Existing medicines start with **Packaging to Review**. Existing invoice unit fields remain null, identifying legacy rows. Historical return reporting is retained. New discrete stock is enforced with integer validation; existing numeric columns remain to preserve historical fractions. Currency remains PostgreSQL numeric; browser sale totals use integer minor units.

The old purchase generated line-total expression is removed **without removing its stored values**, permitting higher-precision base costs; a trigger computes totals for new/changed lines. The batch uniqueness constraint is removed so different receipts never overwrite each other's expiry or cost. Existing master-price writes are revoked from authenticated clients; use the guided save RPC.

## Safe staging and backfill

1. Back up the hosted database and run [the read-only preflight](../supabase/inspection/packaging-review.sql). Resolve duplicate identity groups with the Owner; do not merge financial history automatically.
2. Test the migrations against a staging copy. The local verification used PostgreSQL 18 with a minimal Supabase Auth identity fixture; the configured Supabase target is PostgreSQL 17. The hosted PostgreSQL 17 transaction and role checks have now passed; see the rollout report.
3. Use a maintenance window to apply all three migrations and deploy this application together. Legacy medicines cannot be sold/restocked until the Owner confirms their smallest stock unit and pack sizes.
4. For each review item, compare the recorded balance with a physical count. Use **Correct Stock** if necessary, then edit the medicine and confirm that the remaining count represents the chosen smallest unit. Enter pack sizes from the actual pack and set valid unit prices/limits. Confirmation itself never changes quantity.
5. Review old drafts before posting: their quantities are retained in their original recorded units. Do not post an ambiguous draft until the Owner verifies it.
6. Verify one Owner and one Salesperson over the real Data API, then check a low-value sale, receipt, restock, return, stock movement and financial report. Restore a backup for a failed pre-release rollout; after new transactions exist, use a reviewed forward migration.

Previously blended receipt costs and historical packaging that was never recorded cannot be reconstructed automatically. Keep these historical costs and flag uncertain stock for Owner review.

## Verification

Run:

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:database
npm run test:workflows
npm run test:e2e
```

`test:database` uses a dedicated localhost PostgreSQL cluster at `.local-test-db`, port 55439, and creates/drops only its own disposable databases. Set `PG_BIN` if PostgreSQL binaries are elsewhere. It does not read hosted credentials.

`test:workflows` renders the actual Inventory, MedicineForm, RestockForm and PosWorkspace in an isolated browser fixture, with mocked authentication/network boundaries. Vite is used only by this test fixture and is already present through Vitest. There is no authentication bypass or test page in the production application.

Coverage includes all 19 requested scenarios: guided entry; 2 x 10 x 10 conversion; tablet/strip/box deductions; mixed units and independent prices; restocking without duplicate medicines; expired/insufficient stock; real simultaneous connections; actual batch COGS; role denials; preserved legacy history; phone layouts; sealed-item restrictions; FEFO; authorized returns; and standard/thermal receipt unit rendering. Additional cases cover nonstandard pack sizes, lost responses, simultaneous identical retries, duplicate return approvals, repeated partial returns, non-saleable returns, exact discounted refunds and stale physical counts.

Browser widths: 320, 360, 390, 430, 768, 1024 and 1440. Screenshots are retained under `test-results`; the Playwright HTML report is under `playwright-report/workflows`. Exploratory browser checks include combined stock limits, Tab focus cycling, Escape focus return, F4 search and visual inspection of mobile forms, inventory and checkout.

## Executed results

- TypeScript, ESLint and production Next.js build: passed.
- Unit/API/standard and thermal receipt rendering: 16 passed; one configured hosted integration test skipped.
- Actual workflow components in Chromium: 56 passed across seven widths.
- Existing Next.js anonymous route/login matrix: 14 passed; its 14 password-based signed-in checks remain opt-in. Separate real Owner and Salesperson Auth/Data API/browser checks passed at 320 and 1440 pixels against the production build; no emails were sent or test business records committed.
- Hosted PostgreSQL 17: 56 transaction/permission assertions passed, with all fixtures and sequence changes rolled back.
- Real local PostgreSQL migration/transaction suite: passed, including legacy refunds, variable packs, FEFO COGS, permission denials, physical counts, distinct concurrent checkouts and identical retries.
- Exploratory phone interaction and screenshot review: passed (combined stock guard, keyboard focus cycle/return, F4 and Inventory layout).

## Hosted rollout and remaining checks

The three migrations are now applied to the linked hosted project. The restored-copy rehearsal and hosted fingerprint checks preserved the original records before the Owner-authorized demo cleanup. Hosted PostgreSQL passed 56 transaction/permission assertions, with fixtures and sequence changes rolled back. See [the hosted rollout report](HOSTED-ROLLOUT.md).

The demo medicine and its exclusively linked demo transactions were removed after the user confirmed they were disposable. Both staff accounts remain intact. No ambiguous real stock was converted or invented.

Legacy API keys remain enabled at the user's request. The credential removed from the example environment file has not been revoked.

The application has been built and tested locally; remote application hosting, SMTP delivery, physical barcode/receipt hardware and an observed first-time-user trial remain outside this session's verified checks. No attached reference image was available; the existing Qeilvra navy/blue visual identity was retained.
