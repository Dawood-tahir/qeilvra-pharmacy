# Invoice archiving — implementation and activation record

Continuation: [INVOICE-LEDGER.md](INVOICE-LEDGER.md) documents migration 017,
verified deletion into a compact retained ledger, hosted checks and current
activation gates. The permanent-retention statements below record the earlier
backup-only implementation and are superseded by that continuation.

Status: local verification only. No hosted migration, deployment, production upload,
or activation has been performed. Production deletion is structurally blocked.

## Existing work resumed

The working tree already contained the cron and download routes, download component,
worker, storage adapter, workbook codec/types, migration 016, workbook/SQL tests,
ExcelJS dependency/lockfile changes, environment placeholders, proxy exception and
Vercel schedule. These were retained. The download component was not integrated in
the Sales/Invoices page and the archive SQL suites were not in the final database
test sequence.

## Retention decision and dependency audit

The workbook is a backup of the operational ledger. Archiving does not hide invoices
or remove them from the existing history, POS, returns or reports. All canonical
transaction rows remain in PostgreSQL. No alternate totals are added to reports,
so there is no second source of transactions to double-count.

Deleting the current rows would break these existing dependencies:

| Source | Consumers that require retention |
| --- | --- |
| `sales`, `sale_items` | Dashboard/report revenue, discounts, extra charges, invoice and medicine sales counts, invoice list/detail, receipts and return lookup |
| `sale_item_costs` | Historical COGS, gross/net profit, batch allocations and return cost reversal |
| `payments` | Cash/card sales and refunds, receipt tender/change information |
| `sale_returns`, `return_items`, `return_allocations` | Refund totals, refundable quantities, restock allocations and profit reversal |
| `stock_movements`, `medicine_batches` | Stock history, quantities, expiry, valuation and batch cost provenance |
| `expenses`, `purchases`, `purchase_items`, suppliers | Expenses, net profit, purchases and supplier history; archiving leaves these records intact |
| `audit_logs`, profiles | Transaction audit and cashier identity |

The SQL migrations define transaction foreign keys with RESTRICT/NO ACTION for
sales/items/costs/payments, and return item ownership includes a cascade. The archive
manifest adds a foreign key to `sales`. No delete/cascade is invoked by the worker.
The archive settings enforce `CHECK (deletion_enabled = false)` and versions enforce
`deleted_count = 0`. There is no deletion RPC or environment switch that bypasses
this protection. Owner approval alone cannot enable deletion in this implementation.

Database storage reclamation is therefore intentionally **not implemented**. A
future reviewed ledger/retention migration would need to preserve every detail used
by current and future returns/reports before deletion can be considered. PostgreSQL
can reuse space from safely deleted tuples after normal vacuuming; this release
deletes no invoice tuples and does not run VACUUM FULL or change autovacuum.

## Backup protocol

Eligibility is based on database time: `completed_at < run.cutoff`, with a cutoff
fixed at claim time minus 15 days. Exactly 15 days old remains active until a later
run. Invoices with a pending requested return are deferred. Finalized return
transactions are included, and changes to already archived invoices are exported
as revisions on later runs.

Each workbook contains invoice/item/payment/cost/return/allocation/stock/audit
details, readable worksheets, the exact PostgreSQL JSON text, SHA-256 source hashes
and a current manifest. Decimal tokens remain text without JavaScript rounding.
Distinct prior revisions are retained; each invoice has one current projection.
Formula-looking customer/medicine text is stored as text cells.

`Qeilvra_Invoices.xlsx` is the stable downloaded filename and logical cumulative
workbook. Storage uses immutable `versions/<generation>/<lease>-<hash>.xlsx` objects,
rather than overwriting the last good backup. The next version includes every
previous invoice. A database pointer publishes the verified version atomically.
This is deliberate: failed or interrupted uploads must not destroy the last backup.

The worker downloads and checks the previous workbook, builds the cumulative
version, uploads it, downloads it independently, checks length/hash/schema/all
snapshots/projections/manifest, and only then commits metadata. Source changes
between selection and publication reject the commit for a fresh retry. Late
changes after publication are picked up as revisions. Publication writes archive
metadata only and does not lock every public table or alter business transactions.

Database leases, monotonically increasing fences and generation checks serialize
runs. Commits are idempotent for identical metadata, including a lost HTTP response.
A killed worker's lease expires after five minutes. Uploaded but unpublished objects
are harmless orphans; the next run rebuilds from the last committed version. Keep
all published versions. Any future orphan cleanup must use the Storage API and
check committed keys/live leases; no automatic cleanup is included here.

## Configuration and access

Apply `supabase/migrations/202610210016_invoice_archives.sql` after migrations
001–015 in a disposable staging project first. It creates the private archive
metadata tables, service-only RPC wrappers and private `invoice-archives` bucket.
It refuses an existing public bucket. A restrictive Storage policy prevents anon
and authenticated users accessing archive objects even if broader policies exist.
The server secret performs storage operations; it must never reach browser code.

| Variable | Required value/use |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing browser/session key |
| `SUPABASE_SECRET_KEY` | Existing server-only service credential |
| `CRON_SECRET` | Random secret of at least 16 characters; required for scheduled authentication |
| `INVOICE_ARCHIVE_DRY_RUN` | Keep `true` initially; unset also means dry run. Only literal `false` requests publication |

Database `private.invoice_archive_settings.enabled` starts `false`. Dry runs can
verify an upload while this remains false, but do not advance the current version
or make a download available. Publishing requires both this database setting and
`INVOICE_ARCHIVE_DRY_RUN=false`; neither enables deletion.

The existing Invoices navigation uses `/sales`. Its Owner-only download button
calls a server route which verifies the signed-in user and active database Owner
role before creating any admin client. The route verifies the current workbook
before returning a 60-second signed download URL. Responses are private/no-store.
The exact cron path bypasses staff-session proxy checks but requires the cron
Bearer secret before admin access. Other routes keep their existing checks.

The daily Vercel schedule is `0 21 * * *` (21:00 UTC, 02:00 Asia/Karachi the next
day). It uses a Node.js route with `maxDuration=300`; verify function duration and
memory on the actual hosting plan. Vercel sends `CRON_SECRET` as a Bearer token,
allows overlapping executions, and does not retry failed cron invocations. See
[Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
Hobby daily timing is approximate; see
[Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
Storage uses the server credential as described in
[Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

The worker bounds each invocation to 25 candidates per batch, at most four batches
and a nominal 200-second budget. These are resource limits, not assumed business
volumes. A `partial` response with `resumeRequired=true` means another invocation
is needed; watch for sustained backlog. Dry runs verify one batch only. Workbook
limits are 32 MiB compressed, 256 MiB inflated, Excel worksheet/cell limits and
explicit configurable invoice/revision limits. Reaching a limit stops publication
and retains all source data; it never truncates the backup. Stage with realistic
volumes before approval. Database RPC HTTP waits are bounded to 45 seconds;
configure/monitor database statement timeouts separately as appropriate.

## Required before hosted activation

1. Review/apply the migration to disposable staging, with the same Storage/RLS
   setup as production. Confirm broad existing policies cannot expose this bucket.
2. Run dry-run upload/readback, corruption, interruption, concurrency and recovery
   checks against real staging Supabase Storage. Standalone SQL tests use storage
   catalog stubs; in-memory adapter tests do not prove hosted network behavior.
3. Reconcile staging financial reports and inventory before/after publication and
   after a late return. Check actual backlog, workbook growth, memory and runtime.
4. Obtain explicit Owner approval before any production deployment/publication.
   Keep deletion blocked. A separate safe-ledger implementation, fresh destructive
   reconciliation tests and explicit activation approval are required for deletion.

The local database harness needs PostgreSQL and Node.js 22.18+ or 24 (erasable
TypeScript support for the production workbook codec). It uses a disposable
database under the workspace cluster at `127.0.0.1:55439`, verifies the server's
data directory, and drops the created databases in `finally`. No production
credentials or invoices are needed.

The checked commands are `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run test:database`, and the existing anonymous Playwright
smoke tests across ten viewport projects. Archive worker tests use actual Excel
bytes with isolated storage/RPC adapters. Database checks additionally round-trip
actual SQL snapshots through the production Excel codec, publish the real hash
and manifest, append refunded invoices/revisions, serialize simultaneous claims,
and run a real checkout while archive publication is open. Exact canonical table
fingerprints and report outputs reconcile, including fractional COGS, refunds,
discounts, extra charges, cash/card, expenses, stock, and supplier history.

Hosted Supabase HTTP tests require a disposable project and explicit opt-in;
they are skipped without that configuration. Hosted Storage and authenticated
browser flows have not been exercised. See the final task report for counts and
any failed checks; local success does not activate production.

## Final local verification results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, zero errors or warnings after removing unused test placeholders |
| `npm test` | 321 passed, 1 skipped (disposable hosted Supabase HTTP integration) |
| `npm run build` | Passed; cron/download routes compiled as dynamic Node routes |
| `npm run test:database` | Passed, including archive protocol, financial/inventory reconciliation, real SQL/XLSX and concurrency |
| `npm run test:e2e -- --grep "protected routes\|login is usable" --workers=2 --reporter=line` | 20 passed across ten viewport projects |
| `git diff --check` | Passed |

The full workflow browser suite and authenticated hosted browser flows were not
run. No destructive test used production data. No deployment or hosted migration
was performed.

## File inventory

Changed or added during this continuation:

- `app/(app)/sales/page.tsx`
- `lib/invoice-archive/backend.ts`
- `lib/invoice-archive/worker.ts`
- `supabase/migrations/202610210016_invoice_archives.sql`
- `scripts/test-database.mjs`
- `tests/database/invoice-archives.sql`
- `tests/unit/session-proxy.test.ts`
- `tests/unit/invoice-archive-backend.test.ts`
- `tests/unit/invoice-archive-page.test.tsx`
- `tests/unit/invoice-archive-routes.test.ts`
- `tests/unit/invoice-archive-worker.test.ts`
- `docs/INVOICE-ARCHIVING.md`

Existing unfinished work retained without replacement:

- `.env.example`
- `app/api/cron/invoice-archive/route.ts`
- `app/api/invoices/archive/route.ts`
- `components/sales/archive-download.tsx`
- `lib/invoice-archive/types.ts`
- `lib/invoice-archive/workbook.ts`
- `lib/supabase/proxy.ts`
- `package.json` and `package-lock.json`
- `tests/database/bootstrap.sql`
- `tests/database/archive-accounting-equivalence.sql`
- `tests/unit/invoice-archive-workbook.test.ts`
- `vercel.json`
