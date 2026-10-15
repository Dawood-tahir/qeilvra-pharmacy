# Security model

## Trust boundaries

The browser is untrusted. Prices, discounts, roles, stock, invoice numbers, costs, and totals are re-derived or authorized in PostgreSQL. Route visibility and hidden buttons improve usability but are never treated as authorization.

Supabase Auth identifies the user. `profiles.is_active` and `user_roles.role` determine application access. The application calls `auth.getUser()` for protected server work instead of trusting an unverified session payload.

## Cost isolation

The salesperson-readable `medicines` and `sale_items` tables contain no purchase cost. Costs live in `medicine_costs`, `medicine_batches`, `purchase_items`, and `sale_item_costs`, whose policies return no rows to a Salesperson. Safe security-definer search/report functions expose only explicitly declared selling fields.

## Atomic operations

`checkout_sale` locks all eligible batch rows in a deterministic medicine order, validates stock and server-side prices, consumes FEFO batches, inserts the sale/items/cost allocations/payment/movements/audit entry, and returns one result. Any exception rolls back the whole function.

`post_purchase`, `adjust_stock`, and `review_sale_return` use the same all-or-nothing database boundary. Historical sales are not updated or deleted to simulate returns.

## Service key use

The service key is required only for the one-time Owner bootstrap and Owner-authorized Salesperson Auth administration. Both are server-only modules. The public application never receives or serializes the secret key.

## Operational controls

- Keep Supabase public registration disabled.
- Require MFA for the Supabase dashboard and hosting provider.
- Rotate the service key after suspected disclosure.
- Back up before migrations.
- Review `audit_logs` for medicine price, role, expense, settings, stock, checkout, and refund events.
- Test policies with actual Salesperson JWTs after every schema change.
