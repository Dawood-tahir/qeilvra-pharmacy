# POS workflow database rollout

Status: migrations `202610190008`–`202610190012` were applied after explicit user approval. A private backup was saved first. The single transaction verified unchanged historical records across all 24 public tables. Read-only checks confirmed working Owner and Salesperson lookup and authenticated-only RPC execution. No hosted test sales or refunds were created.

Hosted read-only inspection found migrations through `202610180007` only. The deployed API cannot find `return_sales` or `complete_sale_return`; those functions are introduced in `202610190009`. This causes the POS recent-sales error and prevents direct returns.

Apply the pending migrations in order after explicit approval:

1. `202610190008_custom_sale_prices.sql` (existing checkout prerequisite).
2. `202610190009_instant_returns.sql` (existing atomic direct returns and scoped lookup).
3. `202610190010_security_hardening.sql` (existing inactive-account guards).
4. `202610190011_query_performance.sql` (existing reporting and query improvements).
5. `202610190012_pos_workflow.sql` (final inventory pricing, discounts, charges, exact tablet returns, reports).

The final migration adds separate sales charge fields and item-discount snapshots, adds exact base quantities to existing return items, and increases return quantity precision. It updates the sales-total constraint and transaction functions. Existing invoice prices, financial amounts, stock, and historical returns are preserved. RLS stays enabled. No production sale, refund, or stock movement is required for rollout.

Deploy the migrations and application together: the new checkout API requires the extended checkout function. Take a backup and recheck hosted migration history first. Use one database transaction for the pending SQL and migration-history entries, with lock/statement timeouts, then reload the PostgREST schema cache. Do not apply the old custom-pricing migration by itself as the final state.

Post-deployment read-only checks: verify all versions exist; check function signatures and grants; verify historical invoice/stock/payment values are unchanged; authenticate both roles and confirm the recent-sales API loads. Keep refund/checkout mutation tests confined to disposable local data.

Business rules retained: Salespeople access their own sales; Owners access all sales. Both complete authorized direct POS returns without approval. Card refunds require external-terminal confirmation. Extra charges are retained when medicine is refunded. Resale stock restoration uses the original batch allocation and rejects expired/quarantined stock.

Local validation is provided by `pnpm test`, `pnpm test:database`, and the POS/returns Playwright workflow suites. The database runner exercises old contracts first, then upgrades and validates the new workflow with synthetic transactions, role restrictions, stock allocation, profit reconciliation, and concurrent retries.

Validation completed: TypeScript, ESLint, production build, 142 unit tests (one pre-existing test skipped), and 161 browser workflow tests across seven widths passed. Four focused discount/charge browser checks were repeated after the final exact-percentage rounding change. Mobile and desktop screenshots were also reviewed. Hosted checks were read-only; physical printer and card-terminal hardware were not exercised.
