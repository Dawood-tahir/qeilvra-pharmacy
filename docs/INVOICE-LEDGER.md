# Safe deletion continuation

This supersedes the permanent-retention decision in INVOICE-ARCHIVING.md. No hosted
migration, deployment or production deletion has been performed. Dry run defaults
to true. Both the server and database deletion gates default to false.

## What stays and what is deleted

The financial ledger remains at invoice-line granularity because original prices,
discounts, selling-unit conversions and batch cost allocations are necessary for
medicine reporting and late refunds. Summarizing them into daily totals would lose
information required by existing features.

| PostgreSQL data | Retention |
| --- | --- |
| `sales` headers | Retain invoice identity, cashier, dates, status, customer, totals, discounts and extra charges for history, receipts, reports and return serialization |
| `sale_items` active rows | Keep for at least 15 days; delete only after the current cumulative XLSX is independently downloaded and verified and the retained representation reconciles exactly |
| `private.invoice_item_ledger` | Stable ID/sale/medicine/selling-unit anchors for active lines; exact original numeric fields and timestamps for archived lines |
| `private.invoice_item_presentations` | One shared exact medicine-name/SKU/unit-label tuple per distinct historical presentation; retains historical labels without repeated copies per invoice |
| `sale_item_costs`, payments, returns, return items/allocations | Retain all original batch cost, tender/change, refund and eligibility records |
| Medicines, units, batches, purchases, suppliers, expenses, stock movements | Retain unchanged; pruning invokes no stock transaction or quantity recalculation |
| Audit logs | Retain, including refund request data used by existing idempotency checks |
| Archive manifests/versions/prune receipts | Retain source digests, immutable workbook locations, generations and idempotent operation results |

Deleted invoice details are original rows in `public.sale_items`, including their
repeated presentation strings and active-table index entries. Historical financial
line values remain in the compact ledger. Invoice headers are not deleted. This
does not remove old receipts, historical invoices, reports or late-return support.
The full original transaction is also preserved in Excel; no per-invoice full JSON
copy is added to PostgreSQL.

`public.invoice_item_rows` reads active rows plus archived ledger rows, with
disjoint branches. Its columns reproduce the original line shape exactly. A
security-invoker computed relationship preserves existing `sale_items(...)` receipt
and count embedding. See [PostgREST computed relationships](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html#computed-relationships).
Existing SQL functions are rewritten only to read that relation; migration 017
stores their before/after definitions for review. Arithmetic, rounding, date rules,
pricing, POS INSERT targets and authorization guards remain unchanged.

Foreign keys from costs and return items point at permanent line identities in the
ledger, with no cascading delete. A trigger creates anchors for new POS lines.
The original invoice/medicine/selling-unit uniqueness spans active and archived
identities. A future column/type mismatch blocks pruning until a reviewed ledger
migration can preserve that new data too.
Archived financial rows are not writable by staff. The view and shared labels use
the existing Owner/cashier scope through RLS. No costs are added to receipt rows.

## Atomic deletion and recovery

Migration `202610210017_invoice_retained_ledger.sql` follows 016. Its prune RPC
requires a current service role, live lease/fence, current workbook generation/hash,
database enablement, non-dry-run claim and an idempotent operation UUID. The worker
also requires the separate server deletion flag and verifies stored workbook bytes
again before pruning. Recovery verifies an already published workbook before
resuming a deletion interrupted after publication.

For each eligible invoice the RPC locks the same parent sale as the existing refund
paths, skips a busy sale, defers requested returns, and compares the current source
hash with the verified manifest. Changed sources must be exported again. It copies
required financial fields into the ledger, normalizes exact historical labels,
deletes active originals, and reconstructs the complete source payload. Any mismatch
rolls back the transaction, including the delete. No stock or financial transaction
is emitted. A direct DELETE guard rejects deletion outside this protocol.

Completed, partially refunded and refunded invoices qualify only when strictly
older than the fixed 15-day cutoff. Recent invoices remain active. Failed uploads,
corrupt downloads, expired leases and failed commits cannot authorize pruning.
Lost deletion responses replay the same operation receipt; later runs cannot delete
the same original row twice. Bounded runs report `resumeRequired` and continue on
subsequent scheduled invocations, including a backlog of previously published rows.
RPCs handle at most 100 invoices per batch, but the default invocation continues
within its 200-second runtime budget rather than assuming a fixed daily volume.
Workbook size/memory limits remain fail-closed; sustained capacity/backlog must be
measured against actual usage before activation.

Late refunds use the unchanged original-price and cost-allocation routines through
the retained line view. Header corrections remain visible and produce a new archive
revision. Line amounts remain immutable through existing staff APIs as before;
changing Excel never changes the operational ledger. Any future line-edit feature
must explicitly maintain the ledger and the existing accounting invariants.

## Space measurements and limits

Local PostgreSQL 18 measurements used 12,000 synthetic invoice lines, 100 shared
medicine presentations and 365 days of history. These are benchmark conditions,
not production assumptions. 494 lines remained active and 11,506 originals were
deleted in the isolated sizing fixture.

| Measurement | Bytes |
| --- | ---: |
| Original invoice-line tables/indexes | 4,448,256 |
| Compact live equivalent including active rows, ledger, labels and required uniqueness indexes | 4,341,760 |
| Newly reusable heap after standard VACUUM | 1,978,688 |
| Allocated tables/indexes immediately after standard VACUUM | 8,503,296 |

The final compact live equivalent was about 2.4% smaller **for the invoice-line component**
(106,496 bytes), after including the required cross-history uniqueness index.
Initial allocated size increased: PostgreSQL keeps deleted pages reusable while
the new ledger occupies separate pages. This is not a measured saving for the whole
Qeilvra database or an immediate reduction in the Supabase quota/bill. Required
headers, payments, COGS, stock and audit history continue to grow. Sparse histories,
short labels or mostly unique presentations may save little or nothing after
ledger/anchor/index overhead. Do not activate solely on this synthetic percentage.

Normal autovacuum is enabled and tuned for the active line table. It reuses dead
tuple/index space without a table rewrite; it does not guarantee a smaller on-disk
file. No VACUUM FULL, REINDEX, partition move or paid service is introduced. See
[PostgreSQL vacuuming and reuse](https://www.postgresql.org/docs/current/routine-vacuuming.html).

## Hosted verification on the existing project

The user authorized read-only database checks and isolated synthetic Storage files,
and prohibited hosted migrations, policy changes, real transaction writes and
destructive production tests. The new schemas are not installed on the connected
project, and no private archive bucket was present.

`scripts/test-invoice-archive-hosted.mjs` ran with the existing local credentials and
a temporary private bucket. It performed no auth login/account/session write, no
database mutation and no worker invocation. Temporary keys were recorded before
upload, then removed by exact path; the empty temporary bucket was also removed.

Passed hosted checks:

- Existing database/Storage configuration and policies inspected read-only.
- Actual active Owner and Salesperson database RLS checked with transaction-local
  identities. Salesperson cost and other-cashier visibility remained blocked.
- Owner and Salesperson direct access to the actual synthetic private object was
  denied through database RLS; the application download model remains server-signed.
- Real XLSX upload/download, full hash/schema verification, cumulative append,
  duplicate-key protection, corruption rejection and previous-version recovery.
- Signed download returned verified bytes; anonymous SDK/public URLs were denied.
- Exact temporary object and bucket cleanup verified.
- Live financial and inventory table fingerprints matched before and after.
- Existing lifetime dashboard, annual financial analytics and medicine/cashier
  breakdown outputs also matched before and after the isolated Storage tests.

Unverified hosted checks: the new archive-specific restrictive policy, retained
ledger/prune RPCs, computed receipt/count embedding, and authenticated application
HTTP sessions. Installing migrations would violate the current approval boundary,
so these were not attempted. Existing role checks are not claimed as proof of the
uninstalled ledger policies. Production deletion must remain disabled.

## Configuration and activation

Keep `INVOICE_ARCHIVE_DRY_RUN=true` and `INVOICE_ARCHIVE_DELETE_ENABLED=false`.
Only literal `true` requests the server deletion gate. The database's
`private.invoice_archive_settings.enabled` and `deletion_enabled` are independent
gates; neither is enabled by deployment or migration. The existing daily schedule,
private cumulative workbook and Owner-only download remain in place.

Before production activation:

1. Review migrations 016/017, the narrow function rewrites, FK validation/backfill
   lock duration, expected table sizes and temporary migration/backfill headroom.
2. Obtain explicit deployment/migration approval. Current user instructions prohibit
   applying unreviewed migrations or deploying; no automatic action follows this report.
3. With deletion still off, verify the actual archive bucket policy, new hosted
   receipt/count embedding, reports and late returns through authorized app sessions.
4. Measure representative capacity and backlog behavior, and confirm the planned
   long-term savings justify retaining the extra anchors/ledger.
5. Obtain explicit deletion activation approval, then enable both database and server
   gates with dry run disabled. No daily Owner interaction is required afterward.

The local destructive suite uses disposable databases only. It reuses the existing
independent financial oracle, compares all dashboard/report/stock outputs around
real deletion, tests late returns, and additionally verifies actual SQL→XLSX→prune
reconciliation, replay and concurrent POS. Test results and sizing artifacts are
stored under `.private/invoice-ledger-*`; hosted results are in
`.private/invoice-archive-hosted-results.json`. Node 22.18+ or 24 is needed for the
test harness's erasable TypeScript import.

## Files changed in the deletion continuation

- `.env.example` — explicit disabled server deletion gate.
- `app/api/cron/invoice-archive/route.ts` — forward the explicit gate to the worker.
- `lib/invoice-archive/worker.ts` — verified pruning, recovery, replay, backlog and runtime-budget processing.
- `supabase/migrations/202610210017_invoice_retained_ledger.sql` — compact ledger, scoped reads, exact function rewrites, FK anchors and gated atomic pruning.
- `scripts/test-database.mjs` — destructive local reconciliation, rollback injection, receipt/RLS checks and storage measurement.
- `scripts/test-invoice-archive-hosted.mjs` — read-only production checks and synthetic Storage-only verification/cleanup.
- `tests/database/invoice-ledger.sql` and `tests/database/invoice-ledger-storage.sql` — ledger contracts and synthetic sizing.
- `tests/unit/invoice-archive-worker.test.ts` and `tests/unit/invoice-archive-routes.test.ts` — safety gates, interrupted deletion, backlog and capacity tests.
- `docs/INVOICE-ARCHIVING.md` and `docs/INVOICE-LEDGER.md` — link the prior report to this continuation and document current behavior.

All earlier uncommitted archive work and unrelated changes remain preserved.

## Verification results

- TypeScript check, final production build, ESLint and diff checks passed.
- Final automated suite: 332 passed, 1 skipped (the explicitly gated disposable
  hosted fixture suite was not pointed at production).
- All local PostgreSQL migration, ledger, financial, inventory, permission and
  concurrency suites passed, including unsupported-schema refusal, actual deletion,
  an injected failure after DELETE, exact replay, exact receipt reconstruction,
  cashier RLS, late refunds, original batch costs and normal-VACUUM space reuse.
- Full browser workflow matrix: 1,033 passed and 668 expected viewport skips across
  1,701 cases. Seven cases failed in the parallel run and passed on a serial rerun
  without code changes; the timing failures are recorded, not counted as first-pass
  successes. No unrelated UI or POS code was changed to make them pass.
- Existing end-to-end suite: 20 anonymous checks passed across ten viewport
  projects; 20 authenticated checks were deliberately skipped without live logins.
- Hosted read-only financial/stock/report comparisons and synthetic private Storage
  checks passed, with verified cleanup. The uninstalled hosted archive/ledger
  policy/RPC/receipt integrations remain unverified as explained above.

There is no production storage-saving measurement because no live invoice was
deleted. The synthetic storage figures above include all required ledger indexes.
