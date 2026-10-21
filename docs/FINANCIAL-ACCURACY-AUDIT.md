# Financial, sales and inventory accuracy audit — 21 October 2026

Production investigation used read-only, repeatable-read PostgreSQL transactions
through the existing connected Supabase project. No production invoices, costs,
stock, purchases, expenses, permissions, policies or archives were changed. No
migration or deployment was performed. Existing uncommitted archive work remains
in place. Destructive tests ran only in the workspace's disposable PostgreSQL
cluster, with the runner checking its actual data directory first.

## Verified cause of the screenshot

The final evidence capture is **21 October 2026, 14:02:23 Asia/Karachi**. The
captured transaction and stock rows matched the earlier audit capture exactly.
The screenshot's amounts reproduce from the actual records:

| Monthly metric | Independently reconciled PKR |
| --- | ---: |
| Gross medicine sales | 35,382.00 |
| Discounts, including item discounts | −62.00 |
| Extra charges | +21.00 |
| Approved refunds | −42.00 |
| Net revenue | **35,299.00** |
| Historical sold batch costs less restockable return costs | **7,925,001.83** |
| Gross profit | **−7,889,702.83** |
| Operating expenses | 123.01 |
| Net inventory loss | 0.00 |
| Net operating profit | **−7,889,825.84** |
| Posted purchase receipts | **1,000,309,122.00** |

There are 24 sales, 48 invoice lines, 49 batch cost allocations, 28 payments,
four approved returns, ten posted receipts and ten batches. There are two expense
records, for Rs123.00 and Rs0.01, both dated 20 October. All recorded customer
payment activity in this evidence is cash: sale payments Rs35,341 less refunds
Rs42 equals Rs35,299; card activity is zero.

The dominant receipt is **PUR-20261019-000009**,
`82b3fc0f-20de-40ab-8930-e2f343399de2`. It records **Rs1,000,000,000** for
medicine **td**, batch **3355**: **778 boxes × 560 tablets = 435,680 tablets**.
Its saved base-unit cost is **2295.2625780389276533 rupees**. This came through
the initial-stock/restocking receipt workflow, whose input is the total cost,
divided once by the received base quantity. It was not produced by a purchase
header being multiplied by its item count.

On **QEI-20261021-000024**, six boxes of td consume **3,360 tablets** from
that batch: **3,360 × 2295.2625780389276533 = Rs7,712,082.26** after monetary
rounding. Additional td strip/base sales and other medicines on that invoice
bring its total recorded COGS to **Rs7,771,392.58**, against **Rs24,385** charged.
That invoice's gross result is approximately **−Rs7,747,007.58**, explaining the
large 21 October chart movement. The chart uses actual sale costs, not the
Rs1 billion purchase total.

Other unusually expensive receipts include PUR-20261018-000003 (dd, one strip
of 52 tablets, Rs90,000), PUR-20261018-000005 (paractamol, 37 boxes of seven
tablets, Rs90,000), and PUR-20261018-000006 (82 paractamol tablets, Rs90,000).
These are distinct saved receipts/batches. Record uniqueness is not proof that
their physical deliveries or entered prices were commercially correct.

**No correction to those records is justified without the Owner checking the
original supplier documents and packaging.** Do not replace their costs with
current selling prices, change pack factors, clamp losses to zero, or invent a
different purchase total. The fixes below leave the screenshot's legitimate
transaction-based results unchanged.

## Source and definition trace

| Screen or metric | Calculation source and retained definition |
| --- | --- |
| Owner Dashboard, Reports, refresh API, financial CSV | `owner_financial_analytics` → `private.sales_financial_analytics`; callers in dashboard/reports pages, analytics/export routes. Sale events use `completed_at`; approved refunds use `reviewed_at`, in Asia/Karachi. All use the same RPC. |
| Revenue and counts | Original sale `subtotal − discount + extra_charge_amount`, minus approved refund events. Count original sales once, including subsequently partially/fully refunded sales. Returns are not additional sales. |
| COGS and gross profit | Sum `sale_item_costs.quantity × unit_cost`; subtract original return allocations only for stock marked restockable. Gross profit = revenue minus COGS. Historical costs remain unchanged when catalogue prices change. |
| Net operating profit | Gross profit minus dated operating expenses minus net inventory losses. Stock receipts are never an operating expense. |
| Inventory losses/recovery | Migration 014 wrapper: write-offs plus supplier-return stock costs, less confirmed cash/credit/replacement recoveries. Recognized on removal and confirmation dates respectively. No customer revenue or COGS double posting. |
| Daily/hourly charts | RPC events, Karachi boundaries, cumulative rounding of fractional-paisa costs. Sum of displayed buckets equals the same selected-range totals. Zero line and negative data remain visible. |
| Legacy dashboard/trend/breakdown RPCs | Migration 012 retains sale-cohort reports: later refunds revise the original sale's cohort. These differ deliberately from the current event-date Owner reports. Legacy trend rounds each day independently. Existing contracts were retained, not silently replaced with a new accounting policy. |
| Salesperson dashboard | `salesperson_dashboard`: today's original invoices for that cashier, net of their approved refunds. Helper text now states this definition. It does not claim to be all refund cash activity today. |
| Invoices, receipts, POS | Header totals and saved gross line amounts. Receipts show original charges, discounts, extras and linked returns separately. `pos-totals.ts` uses integer paisa; checkout SQL is authoritative. No POS behavior changed. |
| Cash/card | Original/refund payment rows, by their event timestamps and `kind`; cash tender less change equals the collected amount. Payment method is not inferred from medicine prices. |
| Purchases and purchase details | `create_purchase` selected-unit quantity × unit price, saved received factors; `post_purchase` converts stock only once and allocates invoice discounts proportionally into batch cost. Initial stock/restocks use `receive_stock` with total receipt cost. |
| Dashboard purchase comparison | `withReceiptPurchases` sums posted **headers once**, by `posted_at`, bounded by the financial snapshot timestamp, with keyset pagination and integer-paisa accumulation. Drafts excluded. |
| Purchase history/CSV, Supplier Details | Purchase invoices use **invoice dates**; draft history remains visible. Posted supplier summary excludes drafts/cancelled receipts and deduplicates header IDs. Migration 015 RPC has a paginated application fallback. Receipt-date and invoice-date metrics are explicitly distinguished. |
| Expenses | `owner_expense_total` and analytics sum all matching expense rows by `expense_date`; paginated lists do not cap totals. Current UI records expenses/categories, with no expense edit/delete flow. No removed feature was invented. |
| Returns | `complete_sale_return` / `private.apply_sale_return`; original discounted net line values with cumulative refund rounding. Base quantities and original batch allocations prevent over-return/reuse. Extras remain separate under the existing policy. Unsaleable returns do not restore available stock or reverse their COGS. |
| Inventory / POS availability / supplier alerts | `inventory_search`, `search_sellable_medicines`, `inventory_alerts`, `supplierAlerts`: positive quantities in non-quarantined, unexpired batches, expiry inclusive today. Whole tablet/strip/box quantities use each saved factor. Supplier alerts use pharmacy-wide eligible stock. |
| Stock History, valuation, purchase links | `medicine_batches`, `stock_movements`, `purchase_items`, `stock_receipts`, dispositions/recoveries. Valuation uses remaining base quantity × saved batch cost. Physical count corrections remain distinct from the existing recognized disposal-loss policy. |
| Archive compatibility | Migrations 016/017 and retained `invoice_item_rows` preserve headers, costs, payments, returns, stock history and exact historical labels/financial line snapshots. Active and retained line branches are disjoint. Receipt/return reads continue through the existing relationship. |

All database foreign keys, custom triggers and function definitions were captured
for inspection. Financial source rows are not deleted through purchase, refund,
disposition or archive cascades. Returns lock the parent sale; inventory writes
retain their transaction/idempotency/stock locks. Archive pruning moves required
invoice line fields into the permanent ledger, retains cost/return foreign-key
anchors and never posts a stock movement.

## Proven defects and smallest fixes

| Defect | Before | Verified after |
| --- | --- | --- |
| Purchase money stored in quantity-sized `v_after numeric(12,3)` | Posting a valid Rs1,000,000,000 draft overflowed; transaction rolled back. | Separate NUMERIC subtotal; Rs999,999,987.66 posts after Rs12.34 discount, with 200,000 base units and matching inventory cost. Quantity variable/locks unchanged. |
| Recomputed draft totals not copied back into posting's row variable | A synthetic stale draft recomputed to Rs18, but batch discount valuation used stale Rs8/Rs10 and valued stock at Rs16. | Use the updated header; stock value Rs18. This fixture simulates historical/imported stale metadata with privileged local setup; production staff permissions were not expanded. |
| Disposal snapshots/preview prematurely rounded batch cost to four decimals | Rs9,000/77,900 base units, disposing 1,000: stored/recognized Rs115.50, first response Rs115.53, retry Rs115.50. | Preserve full source NUMERIC; first response, stored value, retry and reports all round to **Rs115.53**. Quantity removed remains exactly 1,000 once. No historical cost backfill. |
| Exact cost lost in JSON/JavaScript before preview | `1.23499999999999999` could become `1.235`, showing Rs1.24. | Owner stock query requests `purchase_cost::text`; integer/rational preview shows **Rs1.23**. No additional table grant or RLS change. |
| Missing cost allocations silently became zero COGS | A damaged local invoice with absent cost rows returned profit based on zero cost. | Current Owner analytics fail closed on missing/incomplete base-quantity cost coverage. Explicit, recorded zero costs remain valid. |
| Nonfinite purchase/batch/cost/expense values admitted by ordinary NUMERIC nonnegative checks | PostgreSQL NaN can pass `>= 0`. | Add finite-money constraints; transaction fails atomically. No valid amount or pricing formula changes. |
| Expense action accepted sub-paisa values for a two-decimal column | A forged/action input such as 1.005 reached database rounding. | Reject before writing; positive two-decimal inputs up to the column's existing limit remain accepted. |
| Expense month start used runtime `setDate` | Can select 2 October rather than 1 October in a server timezone such as Honolulu. | Reuse Karachi/UTC calendar-safe `financeRange`. Current UTC-hosted October totals were not affected. |
| Supplier fallback could accumulate unsafe numeric paisa | Many maximum-sized receipts could exceed safe integer precision. | BigInt accumulation and explicit display-limit error, retaining posted/header uniqueness rules. |
| Missing/invalid money and oversized numeric API responses | Null/nonfinite formatting could show a misleading zero; extreme aggregates could lose paisa. | Show `Unavailable` for absent/invalid/unrepresentable values; financial response validation fails rather than publishing incomplete totals. Conservative display bound is Rs2^45; exact PostgreSQL amounts are retained. |
| Financial cards split large figures and signs; chart labels used huge k counts | Screenshot wrapped digits/signs across lines. | Responsive unbroken amounts, local overflow fallback, negative styling retained; chart axes use compact M/B scale and exact-money tooltips. No dashboard redesign. |

SQL fixes are in **202610210018_financial_accuracy.sql**. It preserves existing
function bodies/formulas, changes only the required posting variables/header
snapshot and adds the cost integrity check. It recreates generated `cost_value`
around the NUMERIC type change, using unchanged saved quantities/costs; it cannot
recover precision already rounded in historic disposition records. No such live
records existed in the evidence. It has a five-second lock timeout and aborts if
the expected function implementation has drifted. It was tested both on the
pre-archive schema and after the retained-ledger migration. Financial fixes do
not require activating invoice archiving.

## Reconciliation and validation

The independent Python Decimal oracle passed **1,416 checks with zero failures**
against the final actual-record snapshot: today, yesterday, Monday-based week,
month, calendar year, trailing year and eight individual date probes; each
financial metric, daily/trend sums, refund/payment coverage, cashier/category/
medicine breakdowns, receipt arithmetic and unit/cost allocations. Legacy
cohort results were checked against their own definition. No missing/zero cost
warning or rounding discrepancy was found in the captured live rows.

All ten batch quantities equal their movement deltas. Remaining physical stock
is **510,772 base units** across medicines, not 510,772 packs. Its recorded cost
is **Rs992,384,120.17**. Remaining inventory plus recognized lifetime COGS
reconciles exactly: **992,384,120.17 + 7,925,001.83 = 1,000,309,122.00** posted
receipts. This is a cost reconciliation, not revenue or profit.

Validation performed:

- `npm test -- --maxWorkers=2`: **351 passed, one skipped**. The skipped test
  requires a disposable authenticated hosted write-test environment; production
  credentials were not substituted for it.
- `npm run test:database`: complete disposable migration, accounting, returns,
  stock, permission and concurrency suite passed. Tests reproduce original
  failures before migration 018 and literal expected values afterward, on both
  pre-archive and retained-ledger schemas.
- Local SQL/XLSX archive integration verifies the backup, performs actual local
  invoice-line pruning, compares receipts/reports/stock, injects failures, retries
  without duplicates, and tests late historical refunds after pruning.
- Financial browser workflows: **63 passed** across 320, 360, 390, 430, 768,
  1024, 1280, 1440 and 1920 pixels, including the screenshot-sized numbers.
- POS/inventory/returns/supplier compatibility workflows: **81 passed** at
  mobile, tablet and desktop representative widths.
- Exact-cost stock/disposal browser workflows: **54 passed** across all nine
  widths, including a decimal text value just below the half-paisa boundary.
  Together, the selected browser runs passed 198 cases; this is not a claim that
  the entire unrelated browser matrix was rerun.
- `npm run typecheck`, `npm run lint`, `npm run build`: passed; no lint warnings
  or TypeScript errors, and no deployment. Responsive screenshots were inspected.
- Initial local runs exposed a generated-column migration dependency and missing
  expense setup in a new test. Both were corrected; the final database run is
  clean. A service-key hosted batch SELECT was permission-denied, so authenticated
  Owner HTTP access to the new text projection was not claimed as verified. No
  grant was added to bypass that restriction; SQL Owner inspection and local
  application/browser checks cover the cost values and text path.

Mandatory scenarios are covered by existing `edge-cases.sql`, `pos-workflow.sql`,
`financial-analytics.sql`, `stock-dispositions.sql`, `supplier-profiles.sql`,
`archive-accounting-equivalence.sql`, ledger tests and the new
`financial-accuracy.sql`: tablet/strip/box and variable pack sizes, multiple
batches/costs, discounts/extras, full/partial/late refunds, purchase discounts,
supplier returns/replacements, losses, expenses, Karachi date boundaries,
archived transactions, decimal/large/zero/missing costs, duplicate/retry requests
and cancelled purchase exclusions. Sales have no cancelled status; failed
checkouts roll back rather than being counted as completed sales.

## Modified files in this audit

- Pages/actions: `app/(app)/expenses/actions.ts`, `expenses/page.tsx`, `stock/page.tsx`.
- Components: `components/dashboard/{dashboard-view,financial-analytics,financial-charts}.tsx`, `components/stock/stock-actions.tsx`.
- Calculation helpers: `lib/decimal-money.ts`, `financial-analytics.ts`, `purchase-analytics.ts`, `stock-disposition.ts`, `supplier-profile.ts`, `utils.ts`.
- Inspection: `scripts/audit-financial-hosted.mjs`, `scripts/reconcile-financial-snapshot.py`; raw evidence remains under ignored `.private/`, without credentials in output.
- SQL: migration 018 and `tests/database/financial-accuracy.sql`; appended checks in existing `scripts/test-database.mjs` preserve its archive work.
- Unit tests: new `expense-accuracy.test.ts`; financial analytics/route, report export, stock disposition, supplier profile and formatting tests.
- Browser tests: financial analytics and stock disposition workflows; exact-text stock fixtures in `tests/ui/stock-data.ts`.
- This report. Previous archive/dependency/session-proxy changes were preserved.

## Remaining review and activation requirements

1. **Owner data review:** verify the Rs1 billion td receipt, the Rs90,000 receipts,
   and their pack counts against actual supplier documents. Four posted receipts
   have no supplier association (allowed by the initial-stock workflow), totalling
   Rs197,999. Do not invent a supplier or treat them as duplicate receipts. Any
   approved data correction needs a separate, auditable plan for the receipt,
   remaining batch value and historical cost snapshots; it is outside this patch.
2. **Review/apply migration 018 and approve application deployment separately.**
   Neither occurred. After approved installation, repeat read-only hosted
   reconciliation and signed-in Owner/Salesperson screen checks. No user login,
   password reset, session generation or permission widening was done here.
3. **Archive activation remains blocked/off.** Hosted migrations 016/017 and their
   settings/prune RPCs are absent. Local defaults remain dry-run true, deletion
   false, and DB flags false. Vercel's remote environment was not changed or
   certified. The missing hosted prune RPC cannot delete through this code.
4. The existing archive work still needs approved hosted installation and checks
   of its actual Storage policies, computed receipt relationship and authenticated
   endpoints, followed by explicit Owner deletion approval. Earlier isolated
   hosted Storage transport verification is documented in `INVOICE-LEDGER.md`;
   it does not certify an uninstalled archive schema. No production workbook was
   overwritten or regenerated. No production storage saving is claimed.

Current live totals reconcile; the code fixes are locally tested, not deployed.
This audit does not certify the commercial correctness of manually entered
purchase costs, or claim that uninstalled production archive deletion is ready.
