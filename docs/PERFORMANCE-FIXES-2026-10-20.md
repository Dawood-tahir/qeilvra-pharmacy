# Performance fixes — 20 October 2026

Implemented small changes to the existing application. Production app deployment, function regions, database records, financial calculations, RLS, credentials and checkout validation remain unchanged. The diagnostic CLI briefly created a project-wide deployment-protection token; that exact new token was revoked, without regeneration, and the original protection rule and zero-token state were verified.

## Changes

| Files | Behavior |
| --- | --- |
| `app/(app)/pos/page.tsx`, `components/pos/pos-workspace.tsx` | Fetch initial 30 medicines on the authenticated server request. Avoid the initial hydration/API/auth round trip. Searches, clearing search, retry and post-checkout stock refresh still use the existing API. An initial RPC failure uses the existing API fallback. Cart and checkout code are unchanged. |
| `app/(app)/medicines/page.tsx`, `app/(app)/suppliers/page.tsx`, `app/(app)/stock/page.tsx`, `components/suppliers/supplier-profile.tsx` | Replace GET search forms with `next/form` client navigation. Keep search/filter URL parameters and existing skeletons. |
| `components/dashboard/financial-analytics.tsx` | Coalesce automatic focus/online/visibility/timer refreshes; never cancel an active user period selection with an automatic refresh. Keep last valid figures on failure. |
| `components/suppliers/profile-refresh.tsx` | Remove 30-second polling. Refresh on return after at least one minute, coalesce focus/visibility events, retain manual refresh and mutation revalidation. |
| `lib/supplier-profile-data.ts`, `supabase/migrations/202610200015_supplier_summary.sql` | One read-only aggregate RPC replaces paged receipt downloads for summaries. History remains 12-row pages; independent history/stock reads run alongside the summary. Posted discounted header totals, draft counts, distinct medicines, last dates, and pharmacy-wide stock alerts retain their existing meaning. RPC uses SECURITY INVOKER, existing RLS and an explicit Owner guard. Only a missing-RPC error uses the old accurate calculation path. Production migration is pending approval. |

Existing request-scoped React caching and verified Supabase authentication are preserved. Dashboard and global-search independent reads were already parallel. Chart loading is already deferred; it was left unchanged because there is no measurement supporting another change.

## Verification

- TypeScript, ESLint and production build pass.
- Unit tests: 177 passed; one hosted write-integration test skipped because disposable-project credentials and explicit write opt-in were not configured.
- Isolated workflow suite: 489/490 passed initially across 320, 360, 390, 430, 768, 1024 and 1440 px. The sole failure was a pre-existing expense status locator matching both “Saving…” and success during a transition; its targeted rerun passed without changes.
- Production-build existing e2e suite: 14 passed, 14 credential-dependent tests skipped.
- Additional real production-build checks passed for both Owner and Salesperson at 1440 and 390 px: initial POS API requests = 0, no horizontal overflow, inventory search preserved `performance.timeOrigin` with zero document requests, medicine results present in server HTML with JavaScript disabled. Salesperson access to Reports still redirects to the forbidden Dashboard.
- Disposable local PostgreSQL migration, stock, cash/card checkout, return, financial and concurrent-write/RLS contracts pass. New summary contracts verify 1,005 invoices without response-cap truncation, exact discounted totals, repeated medicines, drafts, cancelled invoices, empty suppliers, and Owner/Salesperson/anonymous permissions. No test sale, refund, receipt, stock or financial write was sent to hosted business tables.

Supporting test changes are in `tests/unit/{pos-initial-data,financial-refresh,supplier-refresh,supplier-profile-data}.test.*`, `tests/database/supplier-summary.sql`, `scripts/test-database.mjs`, `scripts/ui-test-server.mjs`, `tests/ui/form.tsx`, and `tests/ui/supabase.ts`.

## Measured before / after

Twenty alternating warm samples per application cohort, using unchanged and optimized **local production builds with the same hosted Supabase database**. These are source comparisons, not Vercel region comparisons. Timings include browser automation and waiting for useful medicine content; API samples include response bodies.

| Operation | Before median / p95 | After median / p95 |
| --- | ---: | ---: |
| Owner POS navigation | 2,417 / 3,007 ms | 1,893 / 3,078 ms |
| Owner Inventory navigation | 2,946 / 6,026 ms | 2,918 / 8,506 ms |
| Owner medicine search API | 1,007 / 2,350 ms | 1,170 / 2,354 ms |
| Salesperson medicine search API | 850 / 1,610 ms | 765 / 1,440 ms |

POS median improved **21.7%** and initial medicine API requests fell from **20 to 0 across 20 navigations**. Tail latency did not improve. Inventory and search retain variable hosted Auth/Data API latency; the search endpoint itself was not changed. The normal warm-navigation target is not met. A transient 401 during benchmark setup was retried before these successful cohorts; these measurements are not an availability claim.

The 80 ms fixture API desktop search control remained about 0.41 s median. Cart code was left unchanged; driver-to-result timings varied with verification load and do not establish a sub-100-ms cart guarantee. The JSON evidence includes all desktop/mobile controls, including unfavorable timings, rather than selecting only improvements. Local anonymous login TTFB changed from 29.1 / 60.8 to 19.9 / 29.5 ms without any login implementation change; this variation is not attributed to these fixes, and browser-cached assets were not treated as CDN measurements.

See `docs/performance-2026-10-20.json` for sanitized measurement and workflow evidence. For a supplier with 1,005 receipts, once approved and applied, the RPC replaces six summary response pages with one aggregate response; this is a network-request reduction, not a claimed hosted SQL speedup.

## Hosting and independent login/static delivery investigation

Vercel production inspection confirmed `iad1`. [Vercel lists `syd1` in Sydney / ap-southeast-2](https://vercel.com/docs/regions), beside the audited Supabase database. Identical-source previews were built in both regions using deployment-scoped configuration; the optimized preview is also READY in `syd1`. No `preferredRegion` export was added: the installed Next.js guide marks that API deprecated.

- Baseline iad1: `dpl_2uA6J9mBttRHw1uBZ6gFirAQVoRc`
- Baseline syd1: `dpl_8YuWAqnYcTLvG8MbizNHdrp5pTdt`
- Optimized syd1: `dpl_8CdQ4LrRCKQ9c6s1tuprUje5H6fq`

Regional benchmark requests could not consistently pass Vercel deployment protection. Authentication pages/redirects and timeouts were rejected as invalid application samples. Expiring preview URL access was attempted without disabling Supabase auth. Automatic approval review rejected a proposed temporary preview-only protection exception because its scope/exposure was not sufficiently established. No exception was applied. **There is no valid region A/B result and no production region recommendation yet.**

The captured production login request trace `l4wrp-1792491037190-cccfc4e33b0a` lasted 1,658 ms at the Vercel edge. Nested spans included route resolution 615 ms, function invocation 586 ms, middleware invocation 426 ms, two VM startups 320/210 ms, and bom1-to-iad1 routing 95 ms. These nested durations must not be summed. This single trace demonstrates startup/routing work; it is not a warm p95 or proof of a slow SQL query. Recent login logs had successful serverless/middleware responses and no logged application errors.

An independent public production Chromium waterfall recorded a CSS transfer taking 11,247 ms (TTFB 3,700 ms, download 7,513 ms) and a 1,130-byte JavaScript transfer taking 11,286 ms. Other scripts in the same probe took 176–3,730 ms; two async scripts had not completed at the 15-second capture. These static paths are already excluded from the auth proxy. Their network/download delay needs further CDN/ISP investigation; moving database-facing functions does not establish a fix for it. Vercel aggregate duration metrics returned `payment_required` for Observability Plus; no add-on was enabled or purchased.

## Approval and remaining work

1. Approve a temporary, explicitly scoped preview access exception for the region benchmark, or provide working authenticated preview access. Then collect alternating warm median/p95 cohorts for both regions and roles before choosing a production region.
2. Approve applying the additive supplier-summary migration to production. The old path remains accurate until it is applied, but retains its history-download cost and adds a missing-RPC probe.
3. Approve production deployment of the verified application changes. Keep regional selection separate until valid region measurements exist.

No under-one-second guarantee is made for cold loads, every network, or financial transactions.
