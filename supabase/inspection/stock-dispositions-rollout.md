# Stock disposal and supplier return rollout

Migration for review: `202610190014_stock_dispositions.sql`.

Status: applied to the connected Supabase project after explicit user approval. A private backup was saved first. The migration transaction verified that every existing record across 24 public tables remained unchanged. Hosted migration history now ends at `202610190014`.

The existing batches, stock movements, purchases, suppliers, audit log and receiving functions are reused. One table, `stock_dispositions`, is necessary because the existing movement records do not store a supplier claim, pending/confirmed settlement, actual recovery value or idempotent settlement request. It keeps immutable batch-cost snapshots and links to the original purchase and any replacement receipt. No existing financial or inventory records are rewritten.

Only active Owners can read this table or execute its mutation functions. Direct table writes are denied, including for Owners. Existing RLS remains enabled. Both mutation functions use an empty search path, medicine/batch row locks, request keys and audit records. A repeated request returns its original result; a new request with a stale stock balance is rejected. Sale and refund operations remain unchanged, including the existing expired-batch sale exclusion.

Discard Stock removes only the confirmed quantity and records its actual batch purchase cost. Return to Supplier removes physically returned or segregated stock once, associates its original supplier/purchase where available, and creates a pending settlement. Pending credits are never counted as recovered money. The Owner records a final actual refund, credit or replacement separately; confirmation cannot remove the original stock again or post a second recovery. A replacement requires a new batch, expiry, base-unit quantity and recorded value. It receives real stock through the existing receiving function, links the resulting receipt, and does not record a cash refund or additional payment.

The existing financial query is preserved privately and wrapped by the same public Owner-only analytics function. Customer sales, discounts, returns, COGS and ordinary operating expenses retain their calculations. New period figures use Asia/Karachi action/confirmation dates:

`Net Inventory Loss = Discard Cost + Returned Stock Cost − Confirmed Refunds/Credits − Replacement Stock Value`.

`Net Operating Profit = Gross Profit − Operating Expenses − Net Inventory Loss`.

For example, discarding 7 tablets at Rs. 2 and returning 15 at Rs. 2 gives Rs. 44 removed stock value. A confirmed Rs. 12 credit and Rs. 8 replacement batch leave Rs. 24 net inventory loss. The replacement is an inventory asset recovery, separate from the refunds/credits figure and customer revenue. Purchases remain inventory, not operating expenses. Daily figures and consolidated CSV exports include these fields. Confirmations in a later reporting period appear on their actual confirmation date.

The Stock page provides batch actions and paginated action history; existing Supplier Details and purchase details show related returns and recovery links. Dashboard and Reports show the four requested stock figures and the adjusted operating result. A return has one final settlement, recorded after the supplier resolves it; staged partial settlements are not introduced.

Safe verification uses disposable local PostgreSQL databases and browser fixtures. It covers partial expired disposal, supplier matching, negative/overdrawn stock, stale requests, idempotent retry, actual credit values, replacement rollback and receiving, inventory reconciliation, financial totals and daily reconciliation, forbidden direct writes, Salesperson/inactive-Owner access and the existing checkout/refund contracts. No production stock removals or recoveries are used for testing.

Validated: 166 unit tests passed; one remote integration test was skipped because no disposable remote project was configured. TypeScript, ESLint and the production build passed. The complete local migration/financial/permission suite passed, including concurrent same-key and distinct-key disposal, settlement, checkout and customer-refund requests. All 28 stock browser checks passed across seven widths (320–1440px). A further 64 desktop/mobile regression runs passed for stock reports/CSV links, supplier history, cash/card checkout, receipt printing and customer refunds. Disposal confirmation screenshots were inspected at 320px and 1440px.

After installing the new migration locally, analytics on 5,000 synthetic sales, 5,000 cost allocations, 10,000 medicines and 50,000 batches measured p95 48.4ms Today, 55.5ms Week, 139.3ms Month and 239.3ms Year (20 measured runs each, PostgreSQL 18, excluding hosting/network). The stock-disposition table was empty in this benchmark; stock event correctness is verified separately in the transaction tests. Hosted read-only preflight confirmed migration head 013, the existing receiving function, batch relationships and RLS before the approved rollout.

Post-rollout read-only verification passed: Owner analytics return the new stock figures and reconcile Net Operating Profit; Salesperson execution of disposal, settlement and Owner financial functions is denied. Direct authenticated table writes, anonymous disposal execution and access to the private financial base function remain denied. All public tables retain RLS, the receiving function and batch relationships are intact, and the stock-disposition table contains no test transactions. No production stock removals, settlements or other financial transactions were created for testing.

Apply only after explicit user approval. Before applying, save a private backup and verify the existing migration head is `202610190013`. Apply transactionally and assert that all existing public-table records remain identical; notify PostgREST to reload the schema. Follow with read-only permission, analytics and schema checks. Deploy the related frontend/backend code together with this migration.
