# Supplier profiles

Owners open a supplier card to see contact details, received purchase totals, individual medicine deliveries, invoices and inventory warnings. `/suppliers/[id]` and its data loader both require the existing Owner authorization. Queries use the signed-in Supabase client and existing RLS; there is no service-role access, new table, migration or dependency.

## Source records

`save_guided_medicine` (initial stock) calls `receive_stock`; Add More Stock calls `receive_stock` directly. Both create a posted `purchases` header and `purchase_items` line, plus a batch, movement and retry receipt. Purchases creates a draft header and lines; `post_purchase` receives them. The profile reads purchase headers and lines once, rather than combining these with batches or `stock_receipts` as extra transactions.

Only an exact `purchases.supplier_id` match establishes history. Unassigned historical receipts stay unassigned. Summaries count posted headers as deliveries, sum saved invoice totals after invoice discounts, count distinct received medicine IDs, and use invoice dates for last purchase. These are purchase values, not payments or balances. Draft and cancelled invoices are visible in history and excluded from receiving totals. Separate purchase-item IDs preserve repeated medicine and batch deliveries. Saved received-unit quantities and conversion factors determine displayed quantities and costs; older lines fall back to their saved base quantity and cost.

## Inventory warnings

Medicine eligibility comes from posted supplier purchase lines. Targeted batch queries read stock for those medicines across **all suppliers**, excluding expired, empty and quarantined batches. Availability and expiry boundaries match the existing `inventory_search` and `inventory_alerts` SQL: pharmacy date in Asia/Karachi; expiry on today remains eligible; positive eligible stock at or below `reorder_level` is low; zero is out of stock; the nearest eligible expiry through the configured `pharmacy_settings.expiry_alert_days` is expiring soon. A medicine can have both low-stock and expiry warnings. Inactive medicines are excluded, matching stock alerts. No existing inventory calculation is modified.

Queries batch medicine IDs, select only required columns and range through complete summary/batch results, avoiding one query per medicine and the global alerts RPC's 100-result cap. Detailed history is filtered and paginated on the server, 12 rows per page. Summary scans retrieve only headers and medicine IDs; detailed invoices are fetched only for the requested page. Supabase's default per-response limit should remain at least 200, and the existing purchase RPC limits each invoice to 100 lines.

The visible profile refreshes every 30 seconds, on window focus, and when returning to the tab. Manual Refresh is also available. Receiving and purchase actions invalidate profile pages. Restock links open the existing Add More Stock form with the medicine and an active supplier preselected; inactive supplier history stays readable.

## Verification

Unit tests cover empty and repeated history, duplicate headers, drafts/cancellations, missing supplier associations, exact saved totals, complete pagination, authorization before data access, and failure states. Alert tests cover multiple suppliers' batches, sold-out stock, quarantine, expired batches, inclusive expiry/reorder boundaries, settings and overlapping alerts. Browser tests use the real profile components with isolated Supabase fixtures to check navigation, invoice search/status filters, saved quantities/costs/batches/dates, pagination, restock links, empty states and responsive layouts. Disposable PostgreSQL contracts verify the real receiving relationships and Owner/Salesperson permissions; browser fixtures are not a live Supabase HTTP end-to-end test.
