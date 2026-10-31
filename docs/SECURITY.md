# Security model

## Trust boundaries

The browser is untrusted. Prices, discounts, roles, stock, invoice numbers, costs, and totals are re-derived or authorized in PostgreSQL. Route visibility and hidden buttons improve usability but are never treated as authorization.

Supabase Auth identifies the user. `profiles.is_active` and `user_roles.role` determine application access. The application calls `auth.getUser()` for protected server work instead of trusting an unverified session payload.

## Cost isolation

The salesperson-readable `medicines` and `sale_items` tables contain no purchase cost. Costs live in `medicine_costs`, `medicine_batches`, `purchase_items`, and `sale_item_costs`, whose policies return no rows to a Salesperson. Safe security-definer search/report functions expose only explicitly declared selling fields.

## Atomic operations

`checkout_sale` locks all eligible batch rows in a deterministic medicine order, validates stock and server-side prices, consumes FEFO batches, inserts the sale/items/cost allocations/payment/movements/audit entry, and returns one result. Any exception rolls back the whole function.

`post_purchase`, `adjust_stock`, and `complete_sale_return` use the same all-or-nothing database boundary. Active Owners, Managers and Salespeople complete authorized POS returns immediately. Managers and Owners may handle any cashier's invoice; Salespeople remain scoped to their own invoices. Historical sales are not deleted to simulate returns; the operations review RPC remains for historical requests.

## Service key use

The service key is required only for the one-time Owner bootstrap and Owner-authorized Manager/Salesperson Auth administration. Both are server-only modules. The public application never receives or serializes the secret key.

## Manager permissions

Migrations 019 and 020 add Manager without changing the strict `is_owner()` predicate. `can_manage_operations()` authorizes active Owners and Managers for stock, medicine, supplier, purchase, expense-entry and authorized return workflows. Owner financial RPCs, financial exports, archives, role administration, audit logs and settings updates remain Owner-only. Managers cannot promote themselves or another account through direct database writes.

Manager dashboards contain only stock indicators and invoice identifiers, with no revenue/profit/expense summaries or invoice amount fields in the client payload. Supplier operational summaries omit spend totals; expense entry omits the selected-period total. Individual transaction amounts and purchasing costs remain visible where operational work requires them. Sold-cost and return-cost allocations remain Owner-only. This role hides financial summaries and reporting, rather than concealing every transaction amount.

See [Manager role and rollout](MANAGER-ROLE.md) for the permission matrix, migration ordering, tests and production activation status.

## Operational controls

- Keep Supabase public registration disabled.
- Require MFA for the Supabase dashboard and hosting provider.
- Rotate the service key after suspected disclosure.
- Back up before migrations.
- Review `audit_logs` for medicine price, role, expense, settings, stock, checkout, and refund events.
- Test policies with actual Salesperson JWTs after every schema change.

## 19 October 2026 audit

The Proxy verifies JWT signatures through `getClaims`; protected server operations retain fresh `getUser` checks. Staff/role reads share one request-scoped client and one joined query. No account data or stock authorization is cached across requests.

Migration `202610190010` makes staff checks fail closed for inactive or unassigned Auth identities and restricts inactive refund-history reads. Migration `202610190011` adds measured query improvements and an Owner-only expense-total RPC. These migrations are prepared and tested locally; production application requires approval.

The hosted public Auth settings returned `disable_signup: false` during this audit. The local `enable_signup = false` configuration does not establish hosted configuration. Disable hosted public signup after approval; the Settings screen no longer claims it is already disabled. A privileged key also remains in Git history; its revocation has not been confirmed. Rotating only the currently configured replacement key would not necessarily revoke that historical credential.

See [the audit report](PERFORMANCE-SECURITY-AUDIT.md) for measurements, findings, test scope, and deployment requirements. This is not an ASVS certification or a guarantee that the hosted system is fully secure.
