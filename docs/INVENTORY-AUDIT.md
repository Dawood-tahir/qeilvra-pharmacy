# Inventory and POS audit — 18 October 2026

Reviewed the existing App Router pages, medicine/purchase forms, POS and checkout route, all four migrations, RLS/grants, batch allocation, returns, reports, authentication, responsive shell, and tests before implementation.

## Findings

- The existing base quantity and FEFO batch model is useful, but `units_per_pack` is an unlabelled decimal and there is only one selling price. A tablet can be sold when the Owner already entered stock in tablets; independent tablet/strip/box sales are not supported reliably.
- Add Medicine presents identification, SKU, accounting units and pricing together, then requires a separate supplier purchase and posting process to obtain stock. There is no guided initial stock flow or duplicate-name check.
- POS adds a product immediately with no unit choice. Cart lines are keyed only by medicine. Fractional discrete quantities are accepted by API and database operations. Browser currency totals use floating point. Searches can return out of order.
- Purchase posting merges receipts by medicine/batch/supplier, changes expiry, blends costs, and ignores purchase discount in batch cost. This loses receipt-level traceability.
- Checkout already uses database transactions, FEFO row locks, idempotency keys, authenticated role checks and database prices. Preserve these foundations; add explicit packaging snapshots and deterministic medicine locking.
- Returns lack conversion snapshots and can reuse previously returned batch allocations. Duplicate approval rows can increase the refund twice. Returned COGS needs actual allocation tracking.
- Owner-only cost tables and two-role authentication are already present. Broad direct Owner table writes can bypass transaction rules; new stock/pricing writes should go through validated RPCs.
- `.env.example` contains a server secret. Remove real values and rotate the exposed key outside this repository. Do not reproduce it in logs or documentation.
- Existing mobile shell/cards are suitable. Focused steps, large controls, persistent actions and accessible dialogs are needed within Inventory and POS. Existing browser tests cover login mostly and skip authenticated workflows without credentials.
- No design image is accessible in this conversation. Preserve the existing navy/blue palette, typography, cards and navigation.

## Implementation and migration policy

Add confirmed packaging and allowed selling-unit prices without multiplying any existing quantity. Preserve all historical sales, purchases and stock balances. Flag legacy medicines for Owner review. Use new receipt rows for restocks and snapshot selling units, conversion and prices on new invoice lines. Keep monetary calculations in PostgreSQL numeric and integer minor units in browser totals. Database functions enforce Owner changes and validated staff checkout.

Security references reviewed: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions). New internal privileged helpers belong in a non-exposed private schema; public entry points are invoker wrappers with narrow grants and explicit authorization in their private implementations.
