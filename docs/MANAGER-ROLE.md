# Manager role

Status: implemented and verified locally. Manager migrations 019 and 020 are applied to the configured database; publishing the updated application remains a deployment step.
No existing Auth account or role association is changed by these migrations.

## Access

| Capability | Owner | Manager | Salesperson |
| --- | --- | --- | --- |
| Inventory and stock alerts | Yes | Yes | Yes |
| Medicine creation, prices, receiving and stock corrections | Yes | Yes | No |
| Suppliers, purchases and supplier returns/recoveries | Yes | Yes | No |
| POS and receipt printing | Yes | Yes | Yes |
| Invoice and refund operations | All cashiers | All cashiers | Own invoices |
| Operating expense entry and history | Yes | Yes, without period totals | No |
| Revenue, profit, financial dashboards and reports | Yes | No | Existing own-sales summary only |
| Supplier spend summaries and expense-total RPC | Yes | No | No |
| Financial exports and cumulative invoice archives | Yes | No | No |
| Sold-cost and refund-cost allocations | Yes | No | No |
| Staff invitations, roles, activation and security settings | Yes | No | No |
| Audit log | Yes | No | No |

Managers see individual invoice, purchase and expense amounts needed for operational
work. They do not receive financial summaries or profit reports. An operator who
can read transaction history can calculate amounts from those transactions; this
role does not promise to conceal every underlying sale amount.

## Implementation

- `is_owner()` stays strict. Financial RPC definitions and formulas are unchanged.
- The new `can_manage_operations()` helper includes active Owner and Manager only.
- Operational RPC authorization and RLS policies use that helper. Existing
  transaction arithmetic, price validation, stock conversion, locking and retry
  behavior are preserved.
- The Manager dashboard RPC contains four stock indicators, with no money values.
  The server whitelist also removes unexpected monetary fields from dashboard DTOs.
- Manager supplier summaries contain counts and delivery dates; there is no
  fallback to financial history scans if their RPC is missing.
- Staff administration remains protected by `requireOwner()` and Owner-only role
  RLS. The existing invite and activation controls remain; Owner can select Manager
  in an invitation or change an existing non-Owner staff role.
- Inactive and unassigned identities fail closed.

## Migration and rollout

1. Review and back up the current target project, schema and account-role rows.
2. Apply `202610250019_manager_role.sql` and commit its enum addition before using
   the new enum value in `202610250020_manager_permissions.sql`.
3. Apply migration 020 and record the corresponding migration history. It works
   with both the pre-ledger schema and the archive-enabled schema. Optional ledger
   policies are updated only if those tables already exist.
4. Deploy the reviewed app after approval. Keep an existing Owner available.
5. As Owner, use Staff to invite a Manager through the existing email setup flow
   or assign Manager to an existing Salesperson. Do not assign a real account
   during testing without the user's selection.
6. Verify Manager login/operations and deny Owner reports, exports, archives and
   role changes. Verify Owner and Salesperson behavior with actual sessions.

The configured database has the original migrations through 014, the selected
Manager migrations 019–020, and supplier City migration 021. Migrations 015–018
remain unapplied there. Do not run a blanket database push that installs those
unrelated migrations to add Manager. These two Manager migrations are independently
tested on the 014 schema and do not activate archiving or deletion.

Existing invitation/deactivation flows require the existing server-only
`SUPABASE_SECRET_KEY` in the deployment environment. Never expose it through a
public variable. Existing role updates use the verified Owner session and RLS.

To roll back application access, have Owner reassign or deactivate Manager staff
before reverting the app. Do not remove enum values or the last Owner account as
a rollback shortcut. Restore definitions/policies from the reviewed backup if a
database rollback is required.

## Verification

`npm run test:database` exercises Manager operations and denials against both the
pre-ledger hosted schema level and the final local schema, plus the existing stock,
refund, financial and archive accounting oracles. All fixtures run in disposable
localhost databases and are rolled back/removed.

Unit tests cover Manager identity, financial DTO omission, Owner-controlled invites
and role updates, forged Owner invites, and financial export denial. Browser tests
cover mobile/desktop Manager pages and Owner role controls using isolated fixtures.
The selected Manager account and its database role are configured. Actual Owner
and Manager browser sessions passed supplier-edit persistence checks locally.
Application deployment remains the step needed to publish this UI.
