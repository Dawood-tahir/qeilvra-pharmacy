# Financial analytics rollout

Migration for review: `202610190013_financial_analytics.sql`.

Deployment status: applied to the connected Supabase project after explicit user approval. A private backup was saved first, and the migration transaction verified that all existing records across 24 public tables remained unchanged.

This adds one Owner-only, read-only aggregate RPC and an index on completed refund dates. It adds no tables, changes no transaction functions or RLS policies, and modifies no financial records. Apply only after explicit approval and deploy with the dashboard/report code.

The query counts sales on `completed_at`, approved refunds on `reviewed_at`, and expenses on `expense_date`, using Asia/Karachi boundaries. A return of an earlier sale reduces revenue on the refund date. Only resale returns reverse medicine cost. Exact batch allocation costs are preferred; historical resale returns without allocations use the original recorded average cost and display an explanatory note. Extra charges remain separate and are not refunded through medicine returns.

Gross sales − discounts − refunds = net medicine revenue. Net medicine revenue + extra charges = total revenue. Total revenue − cost of goods sold = gross profit. Gross profit − recorded operating expenses = Net Operating Profit. Posted inventory purchases are shown separately, never as operating expenses. Daily and hourly cost rounding uses cumulative paisa allocation so chart values reconcile with the selected totals.

Dashboard periods: Today (hours through the current hour), This Week (Monday to today), This Month (first to today). Reports also support custom ranges up to one year. Visible analytics refresh every 30 seconds and on focus/reconnection. Failed loading retains the last confirmed figures and offers Retry.

The API authenticates the session, checks Owner access, uses the same aggregate RPC as server rendering and financial CSV exports, and disables shared caching. Salespeople keep their existing dashboard and cannot call the financial RPC. Existing raw transaction CSV exports are retained; completed-refund and consolidated financial exports are added.

Safe validation: `pnpm test`, `pnpm test:database`, the financial analytics Playwright workflow suite, TypeScript, lint, and production build. Run the existing benchmark with `ANALYTICS_ONLY=1` to measure the four financial query ranges on 5,000 disposable synthetic sales. No production transaction writes are needed for verification.

Validated: 156 tests passed (one disposable Supabase integration test skipped), TypeScript, ESLint, production build, the complete local PostgreSQL transaction/permission suite, and 56 financial dashboard/report browser regressions across seven widths. Desktop and mobile report screenshots were reviewed.

Measured local database performance on 5,000 sales, 5,000 cost allocations, 10,000 medicines and 50,000 batches (20 measured runs per range, PostgreSQL 18, excluding network):

| Range | Median | p95 |
| --- | ---: | ---: |
| Today | 76.1 ms | 93.0 ms |
| This Week | 73.5 ms | 119.0 ms |
| This Month | 123.8 ms | 228.1 ms |
| Custom year | 143.2 ms | 187.2 ms |

These database measurements support the sub-second interaction target; actual end-user latency also depends on authentication, hosting and network conditions. Automatic updates use visible-page polling every 30 seconds, rather than a Realtime publication.

Hosted read-only verification confirmed that gross sales, discounts, approved refunds, extra charges, revenue, recorded expenses, daily sums and Net Operating Profit reconcile with existing records. Owner access succeeded; Salesperson and anonymous financial access were denied. Hosted query execution was 95.7 ms for Today (first call), 14.1 ms for Week and 16.0 ms for Month. Management-API round trips took 1.8–2.4 seconds; these are administration transport measurements, not browser interaction timings. End-to-end sub-second latency is a target rather than a verified guarantee.
