# Hosted inventory and POS rollout

Completed 18 October 2026 against the linked Supabase project `pharmacyabdullah` (PostgreSQL 17.11).

## Database release

- Created a consistent logical snapshot of 49 public/Auth/migration tables, functions, constraints, grants and policies in ignored local storage: `.private/supabase-rollout/hosted-before.json`. This contains sensitive account data and must remain private.
- Restored the public business records into an isolated PostgreSQL copy. All three new migrations preserved fingerprints of the original stock and financial rows.
- Applied `202610180005`, `202610180006` and `202610180007` to the hosted database in one transaction through the Supabase Management API. Direct database TCP connections timed out. Recorded the exact repository migration versions in the migration table.
- Verified all original business-row fingerprints again before the authorized demo cleanup.
- Removed only the Owner-confirmed demo medicine **da 46** and its exclusively linked one batch, one purchase and two sales. The cleanup rejects transactions containing any other medicine and records the authorization in the audit log. Both staff profiles and their roles are unchanged. The original demo records remain in the private backup.
- Legacy API keys remain enabled at the user's request. No key rotation, password reset or disabling occurred. The credential removed from the example environment file has therefore not been revoked.

## Hosted verification

- Ran 56 existing stock, pricing, COGS, purchase, return and permission assertions on hosted PostgreSQL 17 in a transaction. All fixtures rolled back.
- Used transactional sequence restarts during those assertions and verified the original sequence state afterwards; invoice and purchase counters were preserved.
- The hosted automatic-RLS trigger also affects new test helper tables. Only the disposable helper table's RLS was disabled within the rolled-back test transaction; application policies were unchanged.

- Verified real Owner and Salesperson sessions through hosted Auth and the Data API. Salesperson cost reads and price/stock/profit changes were restricted; an attempted role update affected no rows and the saved role remained Salesperson.
- Tested the production Next.js screens at 320 and 1440 pixels for both roles: Inventory, guided medicine entry/review, restock access, protected-route redirects, POS search, F4, mobile cart and Escape focus handling. The guided form calculated 200 tablets and retained separate Rs. 7/65/620 review prices without saving a test medicine.
- Verified no unrelated shell page prefetches during POS and confirmed that the private transaction schema is excluded from the Data API.
- Auth verification generated local test sessions without sending emails or changing passwords. Sessions were cleaned up after testing; no test medicines or sales were committed. A timeout initially included a temporary session cookie in diagnostic output; that session was verified inactive, and the private runner now suppresses credential-bearing diagnostics.

See [implementation and complete local test results](INVENTORY-IMPLEMENTATION.md). Machine-readable snapshot, staging, migration, cleanup and verification reports are retained in the ignored rollout directory.

## Remaining checks

The application build is ready locally. No remote application hosting deployment was performed in this session. A physical barcode scanner, receipt printer, SMTP delivery and an observed beginner trial need on-site or service-specific verification. No design reference attachment was accessible; existing Qeilvra styling was preserved.
