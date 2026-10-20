# Qeilvra production polish review — 20 October 2026

## Scope and design decisions

This is an incremental update to the existing Next.js/Supabase application. The initial worktree was clean. No production deployment, new dependency, business-record deletion, permission change, or database migration is part of this patch.

The review covered Dashboard, POS, Inventory, medicine details/edit/new medicine, Add More Stock, Purchases and purchase details, Suppliers and supplier details, Invoices/receipts, Returns, Stock History, Expenses, Reports, Salespeople, Settings, Profile, Alerts, Notifications, Audit, authentication, shared navigation, forms, dialogs, feedback, and loading states. Existing packaging, pricing, batch allocation, stock conversion, checkout, receipt, and refund code was reviewed alongside its tests.

The main problems were equal emphasis on every white card, inconsistent filter/action surfaces, a dashboard with no visible purchase KPI, excess prominence for empty loss summaries, and limited catalog width on compact laptops. Existing review steps, supplier search, responsive tables/cards, cart container queries, and short-window scrolling were retained.

- **Primary glass:** important financial panels, with a fine border, light highlight, restrained 12px blur and layered shadow. Unsupported browsers receive a near-white opaque surface.
- **Secondary glass:** supporting panels and filters, with near-opaque backgrounds and no backdrop filtering.
- **Data surfaces:** opaque table cells, medicine cards, inputs and invoice content for numerical clarity.
- **Navigation:** navy layers and pale-blue active indicators; narrower expanded sidebar at laptop widths; persistent collapse control and mobile navigation.
- **Dialogs:** near-opaque foreground and a 3px backdrop blur; existing native focus containment and return focus behavior preserved.
- **Accessibility:** visible focus, skip link, coarse-pointer input sizing, reduced motion/transparency, forced-color boundaries, and print fallbacks.

Financial figures belong before the main trend. Frequent actions remain near the page heading. Stock alerts and receiving tasks use supporting panels rather than competing with financial results. POS keeps medicines at the top, billing adjustments together, and payment controls at the bottom of its established cart layout.

## Verification

Browser workflow tests use isolated fixture aliases for authentication, Supabase and mutations. Database contracts create unique disposable databases on loopback PostgreSQL; they do not use production credentials.

### Recovery and completed follow-through

The resumed checkout was clean: no staged, unstaged or untracked work was present. The previous work had been committed as `ba4e6d6` (42 files), including the shared glass system, receipt-purchase helper, dashboard KPI grid, Reports purchase comparison, real lazy-chart fixture adapter, and responsive tests. Those implementations were preserved. The reported 17-file uncommitted summary was older than the actual repository state.

The saved polish run had 19 failures. Its chart assertions attempted to serialize `expect.any(Number)` through `toHaveJSProperty`; the actual chart SVG was already rendered. Its short-window test combined many page visits into one default timeout. Final QA documentation was unfinished, and direct receipt-query regression tests were missing.

This continuation:

- Verifies actual plotted lines/dots/bars, all three Reports charts, dimensions, legends, PKR tooltip amounts, Today/Week/Month switching, custom dates, empty figures, loading failures and retry. Legend SVG icons cannot satisfy the chart assertions. Tooltip targeting uses the plotted point rather than an arbitrary edge offset on narrow charts.
- Makes slow/failing-request tests deterministic using an explicitly held response. Corrects the stale analytics API mock and verifies authorization occurs before purchase reads.
- Corrects fixture receipt times to precede the financial snapshot and reconciles two posted receipts (Rs. 12,500), excluding the separate draft and allowing a backdated supplier invoice.
- Extends rendered coverage to medicine details/edit, Profile and Audit. Checks 24 existing module screens, seeded-cart Checkout access, Settings Save access, browser/network errors, short screens, landscape, and reduced accessibility preferences. Compact viewport cases run independently to avoid aggregate timeouts.
- Adds **Purchases Received** to the financial-summary CSV through the existing receipt helper. All earlier financial columns and profit formulas remain unchanged. Purchase-invoice CSV still uses invoice dates and is labeled separately in Reports.
- Invalidates Reports alongside Dashboard after successful initial stock, restock and purchase posting. Adds receipt aggregation and revalidation regressions.
- Changes the remaining violet Reports quick-action accent to sky blue and corrects stale README wording about direct POS returns. Shared components and functioning module layouts needed no rewrite.
- Fixes a real 1280px POS defect found by screenshot review: **Add to Cart** text clipped when a two-column catalogue made the medicine card too narrow. The existing quantity/button row now uses intrinsic flex wrapping, so the full button moves below quantity only when both controls cannot fit. Two class changes preserve the selling/pricing/cart logic. New assertions compare rendered button text and icons against actual padded content bounds, with an additional 1536px case. The before-fix regression failure and screenshot are retained.
- Splits the original cart test's four short-window contexts into independent cases after their aggregate 30-second timeout. The tested checkout behavior is preserved. Single-date chart assertions account for Recharts placing point markers outside its line groups; screenshots and real circle/path geometry confirm rendered content.

### Today's Purchases and financial reconciliation

`lib/purchase-analytics.ts` reads real session-scoped Supabase `purchases` headers only after the Owner financial RPC succeeds. It filters `status = posted`, uses `posted_at` within `[Karachi midnight, following midnight)`, and caps records at the snapshot's `generated_at`. It pages by unique purchase ID, sums each header once in integer paisa, and fails visibly on inaccessible, incomplete or invalid results. Drafts and out-of-period receipts are excluded; invoice date does not determine receiving day.

Dashboard, Reports, the analytics API and the financial-summary CSV all use this helper. Unit cases cover initial stock/restocks/supplier purchases, backdated invoices, both midnight boundaries, snapshot cutoff, 1,205 receipts with a smaller server response cap, decimal accuracy, empty periods and failure handling. The existing SQL RPC still contains an invoice-date purchase aggregate; application consumers replace that aggregate with posted receipts. No schema migration or financial formula was changed.

Gross sales, discounts, refunds, net medicine revenue, extra charges, total revenue, COGS, gross profit, expenses, write-offs, supplier recoveries and Net Operating Profit retain their existing independent definitions. Purchases do not become an operating expense; supplier recoveries do not become customer sales. Disposable database reconciliation and concurrency contracts passed.

### Verification evidence — resumed run, 20 October 2026

| Check | Result / scope |
| --- | --- |
| TypeScript | Passed (`npm run typecheck`); production build also completed TypeScript. |
| ESLint | Passed (`npm run lint`). |
| Unit tests | 196 passed across 24 files; one hosted HTTP integration case skipped. |
| Local database | Passed, exit 0; 295 PASS output lines, including the aggregate 240-case inventory equivalence check. Fresh/legacy migrations, FEFO/conversion/expiry, discounts/charges, cash/card, partial returns, receiving, disposal/recovery, financial reconciliation, RLS, inactive roles, Owner financial isolation and concurrent/idempotent writes covered. |
| Source audit | Passed; final audit inspected 244 files. No privileged literal marker or unused dependency candidate reported. Existing unreferenced modules were retained. |
| Real Next.js login / anonymous e2e | 20 passed across 10 projects, including all nine requested widths and 1280×600. No credentials submitted and no business writes. |
| Production build | Passed, Next.js 16.4.1 Turbopack. |
| Final financial / POS browser checks | **121 passed, zero failures** across all nine widths, plus short/landscape/zoom-equivalent and 1536px cases. Covers all financial filters, exact tooltip amounts, single-date dots, empty/loading/retry/refresh, Owner-only UI, stock-loss reconciliation, rendered medicine-control text fit, cash/card checkout, auto/manual print and four independently bounded short-window checkouts. 104 inapplicable duplicate viewport cases skipped. |
| Broad isolated workflow matrix | 1,010 passed, 528 deliberately inapplicable viewport duplicates skipped. Its 10 initial failures were nine cached pre-fix stock-loss locator cases and one combined cart short-window timeout; every affected case passed in the final focused run above. These counts overlap with final focused checks and must not be summed as unique cases. Original failed traces are preserved. |
| Final chart / accessibility preference check | Three passed: actual Dashboard/Reports series geometry and opaque surfaces with reduced motion/transparency. Real single-day dots are tested separately across every width above. |
| Production browser diagnostics | Passed: 16 checks over local loopback HTTPS, all nine widths plus 1280×600, five anonymous redirects, password-page navigation, original CSP/frame protection. Zero browser errors, console errors, actual failed requests or HTTP errors. Expected cancelled Next.js prefetch/RSC streams are retained separately in the report. Initial HTTP-only harness failure is preserved. |

Machine-local evidence is retained under ignored `.private/polish/`: `resume-unit.log`, `resume-typecheck.log`, `resume-lint.log`, `resume-build.log`, `resume-database.log`, `resume-source-final.json`, `resume-e2e.log`, `resume-workflows.log`, `final-verification.log`, `final-chart-preferences.log`, `production-smoke.json`, browser traces/results and `screens/`. The before-fix POS screenshot and failing text-fit trace are also retained. These artifacts are local verification evidence, not deployed pharmacy data. The broad run's HTML report records its initial failures; the final focused logs record their passing verification.

### Responsive and accessibility result

Rendered module layouts were checked at **320, 360, 390, 430, 768, 1024, 1280, 1440 and 1920px**. Screenshot review covered phone KPI grids, tablet forms, laptop sidebar/content balance, actual chart axes/legends, and POS selection/billing/payment controls. The 1280px Add to Cart clipping was corrected and its text-fit assertions passed at every required width and at 1536px. No remaining page overflow or clipped operational control was observed in the tested fixtures.

Additional cases cover 1366×768, 1024×600, 1024×768 tablet landscape, 844×390 phone landscape, and 125% / 150% / 200% zoom-equivalent CSS viewports, including 512×384. These reproduce layout width/height and DPR; they are not a claim of manually operating each browser's zoom menu. Separate cart tests cover 1366×768, 1024×450, 568×320 and 320×568 with 20 medicines, editable charges and a reachable payment dialog. Existing 0/1/5/20-item cart tests passed throughout the broad width/zoom matrix.

Reduced-motion and reduced-transparency media preferences were emulated and asserted in Chromium; primary/supporting surfaces and navigation became opaque with blur removed. Focus, dialog containment/return, keyboard search and role navigation passed existing workflow checks. This is targeted accessibility verification, not a complete WCAG conformance certification.

### Measured performance scope

After browser checks were idle, a read-only probe collected one discarded warm-up and three warm samples per operation. These measure local Vite fixture UI readiness through actual rendered components, including browser/driver and paint waits. They exclude authenticated Next.js work, Supabase and remote-network latency, and do not establish hosted speed or a before/after improvement.

| Operation | 390px median | 1440px median |
| --- | ---: | ---: |
| Dashboard chart ready | 748.5 ms | 796.1 ms |
| All three Reports charts ready | 966.4 ms | 1,065.0 ms |
| POS medicine and Add action ready | 372.1 ms | 485.5 ms |
| Medicine search, including existing debounce | 272.3 ms | 283.4 ms |
| Supplier details ready | 383.0 ms | 463.2 ms |

All probe samples had no page overflow, and browser issue lists were empty. Samples and methodology are retained in `.private/polish/resume-performance.json`. Production anonymous login navigation timings are retained separately in `production-smoke.json`; authenticated production readiness was not measured. Existing server-loaded POS medicines, lazy chart imports, refresh coalescing and restrained blur were preserved. No sub-second application guarantee is made.

During verification, the system C: drive reported no free space and an npm log/cache write failed. Final test processes used workspace-local temporary files on D: and direct installed tools; no unrelated system files were removed. This workstation storage issue still needs local attention.

### Files changed in this continuation

| Area | Files |
| --- | --- |
| Receiving refresh | `app/(app)/medicines/actions.ts`, `app/(app)/purchases/actions.ts` |
| Financial export | `app/api/reports/export/route.ts` |
| Dashboard accent | `components/dashboard/dashboard-view.tsx` |
| POS label layout | `components/pos/pos-workspace.tsx` |
| Browser fixtures | `tests/ui/auth.ts`, `tests/ui/data.ts`, `tests/ui/financial-data.ts`, `tests/ui/main.tsx`, `tests/ui/supabase.ts` |
| Unit coverage | `tests/unit/purchase-analytics.test.ts` (new), `tests/unit/financial-analytics-route.test.ts`, `tests/unit/receiving-actions.test.ts`, `tests/unit/report-export.test.ts` |
| Browser coverage | `tests/workflows/cart-layout.spec.ts`, `tests/workflows/financial-analytics.spec.ts`, `tests/workflows/responsive-polish.spec.ts`, `tests/workflows/stock-dispositions.spec.ts` |
| Documentation | `README.md`, `docs/PRODUCTION-POLISH-QA.md` |
| Framework-generated types | `next-env.d.ts` (Next.js production build changed references from `.next/dev/types` to `.next/types`; no manual API declaration changes) |

Existing shared glass components, POS behavior, database migrations, dependencies and security policies were preserved. Ignored local capture/performance/smoke scripts and artifacts are also retained in `.private/polish/`.

### Security and verification limits

Fresh session/active-role checks, Owner financial RPC guards, purchase/cost RLS, server-only elevated clients, audit records, transaction locks and idempotency remain in place. Salespeople receive their operational dashboard without Owner financial analytics. No permission, credential, production environment, hosted record or migration was changed; no deployment occurred.

The fixture browser suite verifies the rendered production components with isolated data and mutation substitutes. It does not establish a live authenticated Next.js-to-hosted-Supabase workflow. Hosted write integration requires dedicated disposable-project credentials and `SUPABASE_ALLOW_TEST_WRITES=disposable-only`; these were unavailable. No local Supabase Auth/HTTP service was listening; Docker is installed but its daemon is unavailable. No service was started or image downloaded. Real Owner/Salesperson login/logout against a disposable Auth stack, hosted migration parity, SMTP, physical scanner/printer behavior and a beginner usability trial remain outside this run's evidence.

Historical security documents record hosted public signup enabled on 19 October and unconfirmed revocation of a privileged credential in Git history. Those are unresolved historical findings, not a fresh claim about current hosted state. Hosted settings, credential revocation and pending migration rollout require a separately authorized review/change. No production-readiness guarantee is made while these boundaries remain open.
