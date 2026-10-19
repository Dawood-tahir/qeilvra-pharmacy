# Immediate returns and sidebar toggle

## Deployment

Apply `supabase/migrations/202610190009_instant_returns.sql` before deploying the application changes. It adds/replaces functions only; there are no new tables, columns, dependencies or RLS policy changes. The migration has been tested in disposable local PostgreSQL databases and has not been applied to production.

## Return workflow

POS → Return / Refund loads recent accessible sales, newest first. Invoice or medicine search and pharmacy-local date filters are optional. Choose a sale, enter quantities in its original selling units, enter a reason, select which returned stock is suitable for resale, then Complete Return. Cash refunds are recorded immediately. Card refunds require explicit confirmation that the refund was completed on an external terminal; the application does not send funds to a card.

Both active roles may complete returns. The existing sales boundary remains: Owners can access all sales, Salespeople their own. The scoped `return_sales` function includes all prior completed refunds and historical reservations, including those created by another cashier, without exposing batch costs or broadening table RLS. Current eligibility is checked again by the write transaction.

`complete_sale_return` uses the existing return ID as its retry key. It checks the authenticated actor, original sale, canonical payload and already returned/reserved quantities. Advisory locks serialize a key; sale locks serialize different return keys. Completion reuses the existing batch allocation and cumulative discount/refund arithmetic. The temporary requested row, allocation records, stock movements, refund payment, final status and audit logs commit in one transaction. A new POS return never commits as pending. Retrying the same key/payload returns the saved result; changing the payload or actor cannot create a second refund.

Stored status `approved` continues to mean a completed refund for existing reporting. The UI labels it Completed. Existing requests, rejections, payments and allocations are retained. Legacy request/review RPCs remain compatible, and historical requests can still be resolved by the Owner from the existing Returns screen. The internal allocation function is not directly executable by authenticated clients; legacy review retains its Owner guard.

Refunds use saved custom prices and original discounts, with cumulative rounding for repeated partial returns. Only quantities explicitly marked suitable for resale return to their original batches; expired or quarantined batches cause an attempted restock to roll back. Non-sellable returns consume the original allocation without adding stock. Existing reporting reads the same refund/payment/allocation records, preserving revenue and cost accounting. Audit records include the original sale and cashier, returning cashier, reason, method, quantities, suitability choices, and refund.

Before submission the dialog saves its exact payload and invoice snapshot in staff-scoped session storage. Unknown outcomes lock editing and offer Retry Return, including after closing/reopening or refreshing the page. Missing browser storage prevents starting a refund. Definitive validation failures allow correction; uncertain or unauthorized outcomes retain the key. Completion refreshes POS stock and invalidates relevant inventory, supplier profile, sale, return and reporting routes.

## Sidebar

The top-left menu button collapses desktop navigation to icons with native title tooltips and accessible link labels. The preference is stored on the device. On mobile, it opens a native modal drawer with the existing role-specific links and branding, focus containment, Escape/backdrop closing and automatic closing on link selection. Transitions respect reduced-motion settings. Existing mobile shortcuts and More tools remain available.

## Verification scope

Unit/API checks cover role authentication, input validation, literal medicine/invoice searching, dates, pagination, discounts and unknown outcomes. Disposable PostgreSQL contracts exercise both roles, custom prices, partial refunds, original-unit conversions, historical compatibility, unsuitable/expired/quarantined stock, audit data, cross-cashier restrictions, and simultaneous same-key/different-key refund requests. Browser tests use the real UI with isolated backend fixtures, including retry recovery after refresh, manual card confirmation, both sidebar modes, keyboard focus and role-specific links. These fixtures are not a live Supabase HTTP end-to-end environment.
