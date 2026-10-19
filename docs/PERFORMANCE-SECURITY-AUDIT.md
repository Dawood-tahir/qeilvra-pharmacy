# Qeilvra performance, correctness and security audit

19 October 2026. Started from clean `main` at `24e8bfd`. Changes are local and reviewable; no application deployment, business-data mutation, hosted configuration update, or credential rotation was performed. Hosted checks used temporary existing-staff Auth sessions for reads; those sessions were revoked locally without signing out other sessions or sending emails.

## 1. Measurements

Production application: Next.js 16.4.1, `next build` / `next start`, desktop Chromium, local application server talking to hosted Supabase. Each warm interaction/API/navigation cohort contains 20 observations. WAN latency was variable. These are lab observations, not a production SLA. Existing hosted data was not seeded or changed.

Representative data was tested separately: actual production React POS with 30 synthetic medicine cards and an 80 ms test API response; disposable PostgreSQL 18 with 10,000 synthetic medicines, 50,000 batches, 5,000 sales and 5,000 cost allocations, plus business-contract fixtures. SQL values below are `EXPLAIN ANALYZE` execution times with warm data, excluding network/connection time. They do not predict hosted PostgreSQL performance by themselves.

| Local database query, p95 | Before | After |
| --- | ---: | ---: |
| Blank inventory, 30 medicines | 390 ms | 76 ms |
| Medicine name search | 86 ms | 89 ms |
| Owner dashboard metrics | 236 ms | 231 ms |
| Sales trend | 219 ms | 231 ms |
| Recent returnable sales | 75 ms | 42 ms |

These are the final committed-benchmark-script results. An earlier independent inventory pair also improved, 483 → 108 ms. Earlier larger financial gains were not consistent on repeat; no general financial-query speedup is claimed. Small differences in search/trend timings may be measurement variation.

| Production application interaction, p95 | Owner before → after | Salesperson before → after |
| --- | ---: | ---: |
| Cart update, 30-card controlled dataset | 256 → 201 ms | 236 → 230 ms |
| Medicine search, controlled 80 ms response | 518 → 548 ms | 503 → 548 ms |
| Successful hosted medicine search API | 4,857 → 1,819 ms | 3,344 → 2,471 ms |
| Warm POS navigation, including current medicine fetch | 6,578 → 7,231 ms | 6,599 → 5,127 ms |
| Warm Inventory navigation | 3,854 → 5,159 ms | 3,342 → 5,136 ms |

Navigation medians improved: Owner POS 3,390 → 2,019 ms, Salesperson POS 3,502 → 2,412 ms; Inventory 2,190 → 2,034 ms and 2,334 → 1,961 ms respectively. Tail latency did not improve consistently. Do not interpret the faster medians as meeting the p95 target.

Opening Reports previously caused **six unrequested CSV requests** through Next.js prefetch, and the network-idle probe timed out at 30 seconds. Native download links reduced that count to **zero**. Equivalent probes then loaded successfully in 5.85 and 4.16 seconds; another full-navigation sample settled in 3.12 seconds. Those are single probes, not p95 claims.

Salesperson Dashboard encoded JavaScript bodies decreased from 273,930 to 175,603 bytes, about 36%. The Owner chart still loads when visible; its full Dashboard transfer did not shrink. Optional dialogs load when opened. POS encoded JavaScript was 211,209 → 208,664 bytes. Resource Timing sizes include resources required by the page even when browser-cached.

Single full-navigation samples, HTTP response end before → after: Owner Dashboard 10.27 → 4.59 s, POS 1.26 → 1.66 s, Inventory 2.01 → 1.72 s, Purchases 2.46 → 1.19 s, Suppliers 1.76 → 1.39 s, Returns 2.69 → 2.01 s. Afterward each checked page displayed its actual content. These are not repeat-navigation percentiles or controlled-backend data-volume tests.

Core Web Vitals remain partially verified: observed after-run LCP ranged from 0.92 to 4.74 seconds, CLS was 0 in the sampled pages, and the largest recorded POS event durations were 152/168 ms. Event Timing observations are not field INP. LCP still exceeded 2.5 seconds on some pages; production percentile CWV targets are not established.

## 2. One-second target

Confirmed in these lab cohorts: cart updates, controlled POS search, and the five local database queries above. Not met at p95: hosted medicine search, complete POS/Inventory navigation. Failed hosted return-lookup responses were excluded from success/performance claims.

No hosted page is certified to load within one second at p95. Bulk CSV exports and cold startup were not treated as one-second interactions.

## 3. Implemented improvements and remaining bottlenecks

- Request-scoped Supabase client reuse and a single joined profile/role query. The Proxy verifies JWT signatures with `getClaims`; protected operations retain fresh `getUser` and database authorization checks. No stock, role or account data is cached across requests/accounts.
- Inventory selects a name-sorted page before calculating its stock and units. Filtered/sorted inventory preserves existing eligibility, expiry boundaries, ordering and unit payloads. All 240 role/query/filter/sort/pagination comparisons matched the original JSON exactly.
- Reporting date filters use indexed timestamp ranges with the existing Karachi day boundaries. Three foreign-key lookup indexes support cost-allocation and return queries. Profit/refund formulas were preserved.
- Sales, purchases, returns, audit, expenses and suppliers use bounded pagination. Expense totals now cover the whole selected period rather than the first 200 rows.
- CSV exports read bounded pages, seek by saved date/ID to avoid offset duplicates during backdated inserts, verify completion, and fail interrupted streams. A failed query no longer becomes a plausible empty financial report.
- Search/price/refund dialogs and charts are split by use; currency/date formatters are reused. Aborted medicine/return lookups cannot replace newer results. Supplier focus/visibility refresh events are deduplicated.

Remaining: variable hosted Auth/Data API latency dominates several local-to-hosted interactions. The measured production app has not been deployed alongside the database; verify hosting region/topology and remeasure before promising a latency SLA. Large supplier profiles still scan receipt metadata in bounded pages to calculate accurate history totals; high-volume hosted profiling is needed before replacing that path. The hosted return lookup returns `PGRST202` for `return_sales` (unavailable in the Data API schema cache). Reconcile the deployed migration ledger/schema cache with the pending instant-return release before deployment.

## 4. Loading and failure UX

Added a lightweight existing-brand startup fallback, a protected-layout skeleton boundary, Dashboard/Inventory/POS/Reports skeletons, and POS medicine-card skeletons during the actual initial fetch. Other protected data pages inherit the shared skeleton; the existing supplier-detail skeleton remains. The sidebar/header remain available on normal page transitions.

Loading boundaries have no artificial delay. Skeletons respect reduced motion; chart placeholders reserve height. Local dialog loading states have Close actions. Protected-page and root-layout failures have Retry actions. Failed data queries display errors instead of zero totals/empty records. Checkout and refund success remain dependent on confirmed database responses.

## 5. Safe cleanup

Removed three direct dependencies: `@hookform/resolvers`, `react-hook-form`, `date-fns` (five installed package entries removed by npm). Import scans, scripts/configuration review, dependency-tree checks, builds and workflow tests supported removal. No new application dependencies were added.

No source files, assets, migrations, policies or operational documentation were deleted. The unreferenced browser Supabase helper was retained because runtime deletion evidence was insufficient; it adds no imported application code. The source audit inventories all worktree text/config/test files and reports candidates without automatically deleting them. No current privileged literal was found in source; the final 36 public JavaScript files also had zero configured-secret/privileged-JWT findings. The Git-history finding below remains separate.

## 6. Security and correctness findings

Severity reflects project impact, not an ASVS certification.

| Severity | Finding | Remediation / status |
| --- | --- | --- |
| High | `is_active_staff()` returned SQL NULL for inactive/unassigned identities; procedural `IF NOT` guards could skip rejection. The salesperson dashboard had a similar NULL comparison. | Migration 010 returns false, fixes the role comparison, and blocks inactive refund-history reads. Tested locally for inactive Owner/Salesperson and unassigned identities. **Hosted application pending approval.** |
| High, unresolved | Hosted Auth returned `disable_signup: false`, while local configuration and the Settings screen implied staff-only signup. This increases the importance of the unassigned-identity guard above. | Removed the inaccurate UI claim. Hosted signup was not changed; disabling it requires approval. Owner invitations and existing active roles remain intact. |
| High, unresolved | One privileged credential exists in historical `.env.example` revisions. It differs from the configured key; its revocation/validity was not verified. A valid service key bypasses RLS. | No key was printed or used from history. Reconcile consumers and revoke/rotate the historical credential after approval; changing only the current replacement key may not revoke it. |
| Medium | Login/callback local-path checks accepted browser-normalized backslash redirects. | Shared local-path validation rejects external, backslash and control-character destinations; notification links use it too. |
| Medium, defense in depth | Checkout/signout route handlers lacked explicit browser Origin checks; checkout accepted simple non-JSON content types. | Cross-origin browser mutations rejected, checkout requires JSON, existing auth/RPC checks retained. Tests prove rejection before RPC. |
| Medium | CSV formula checks missed leading whitespace/control characters. | Spreadsheet-dangerous text is escaped, including tab/CR/LF prefixes. |
| High correctness | Expense totals and exports could silently omit older rows; read errors could look like valid empty data. | Complete SQL expense sum, paged/cursor exports, explicit query errors and retry UI; 251-expense and 1,205-row export regressions pass. |
| Low correctness | Inactive users with valid Auth tokens could bounce between Login and Dashboard. | Allow the inactive sign-in error to render; session refresh cookies and private/no-store headers survive redirects. |
| High advisory, development only | `braces` stack-exhaustion advisory through five affected lint-tool package nodes. | Still reported. No patched `braces` version is listed; no forced framework downgrade was applied. Runtime dependency audit reports zero known advisories. |

All business tables retained RLS. Purchase costs and financial RPCs remain Owner-only. SQL search paths, internal refund-function ACLs, direct-write grants, original prices/discounts, FEFO stock, refund allocation, duplicate protection and simultaneous checkout were reviewed/tested. Active Owners and authorized Salespeople retain immediate POS returns; no approval stage was added.

Actual hosted sessions confirmed Salesperson denial of cost/receiving reads, financial RPC/export access and Owner pages. Cross-origin checkout was rejected. These were read/boundary checks, not destructive production security tests. Full deployed catalog/configuration equality with the repository has not been certified. Existing CSP still permits inline scripts; no broader CSP rewrite or claim of complete XSS protection is made.

## 7. Verification

- Final TypeScript, ESLint and production build: passed.
- Final unit suite: **123 passed**, one explicitly gated Supabase HTTP write-integration test skipped. It now requires `SUPABASE_ALLOW_TEST_WRITES=disposable-only` plus dedicated test credentials.
- Full workflow suite: **398 of 399 passed** across 320/360/390/430/768/1024/1440 px. One tablet Salesperson-return timeout then passed **three isolated reruns** without changing return behavior. Its initial cause was not conclusively established; no timeout increase or weakened assertion was used.
- Disposable PostgreSQL: fresh/legacy migrations, receiving/supplier history, costs/profit, custom selling prices, immediate/historical returns, inactive/unassigned access, 251-row expense totals, and all 240 inventory-equivalence cases passed. Competing checkouts, same-key checkout retries, same-key refunds and distinct-key over-refund attempts passed.
- CSV tests include 1,205 records under a smaller server response cap, backdated concurrent inserts, premature empty pages, transport interruption, forbidden Salesperson cost exports and formula injection.
- Final production public-route/mobile checks: **14 passed**, 14 credential-dependent authenticated cases skipped. Separate real Owner/Salesperson readonly checks passed as described above. Hosted date/ID cursor query syntax was validated successfully for both timestamp and date columns.
- The reproducible database benchmark completed successfully. Sanitized measurement summaries are in [the results artifact](audit-20261019-results.json); private logs contain the detailed local runs.

UI workflow tests use the actual components with isolated fixture services; SQL contracts run actual PostgreSQL transactions/roles. They do not constitute a full browser-to-hosted-database write test. No test medicine, purchase, sale or refund was committed to the hosted pharmacy.

Reproduce source checks with `npm run audit:source`; dependency checks with `npm audit --omit=dev` and `npm audit`; business database checks with `npm run test:database`; query comparisons with `npm run benchmark:database`. The benchmark uses only loopback and uniquely named disposable databases; it never reads hosted credentials. Set `PG_BIN` where required and run database tools sequentially. Detailed local logs/measurements remain in ignored `.private/` storage.

## 8. Approval and rollout requirements

1. Review the deployed migration ledger and a fresh backup before changing production. Apply outstanding earlier versions in order, including the instant-return release if absent, then [010 security hardening](../supabase/migrations/202610190010_security_hardening.sql) and [011 query performance](../supabase/migrations/202610190011_query_performance.sql). Both are additive/function/policy changes, with no business-row deletion or table rebuild. **Do this before deploying the application that calls `owner_expense_total`.** Active Owner/Salesperson permissions and immediate returns are preserved.
2. Approve disabling hosted public signup; the repository TOML alone does not do this. Keep Owner invitations and current staff accounts working.
3. Approve reconciliation and revocation/rotation of the historical privileged key. Verify application/admin consumers with the replacement before revoking it. Do not rewrite history or rotate unrelated credentials automatically.

No production SQL/configuration changes, credential rotation, Git push or hosting deployment is included in this audit implementation.

## Research basis

- [OWASP ASVS 5.0](https://owasp.org/projects/asvs): risk-based verification scope; no compliance certification claimed.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): grants/policies/functions and allow/deny database tests.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): service keys bypass RLS; exposed historical keys need deliberate revocation.
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs): verified claims, refresh-cookie handling and caching boundaries.
- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist), plus installed Next.js loading/lazy-loading guides: production measurements, route boundaries, server authorization and split client code.
- [JetBrains: reviewing AI-generated code](https://blog.jetbrains.com/research/2026/10/review-ai-generated/): allocate deeper review to security/transaction code and validate it with explicit tests.
- [Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): development dependency finding and lack of a listed patched version.
- [Supabase regions](https://supabase.com/docs/guides/platform/regions): regional placement matters; deployment/region changes were not performed.
