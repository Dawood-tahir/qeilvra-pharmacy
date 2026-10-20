# Qeilvra Pharmacy Management System

Qeilvra is a security-first pharmacy operations application built with Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL/RLS, Recharts, React Hook Form, Zod, Lucide, and shadcn-style accessible primitives.

It supports two roles only:

- **Owner** — catalogue, suppliers, purchases, batch inventory, POS, expenses, returns, reports, staff, settings, and audit history.
- **Salesperson** — a focused dashboard, POS, sellable stock/expiry visibility, invoices, personal sales, and return requests.

There is no public registration and no customer-management module.

## Inventory and POS update

See [the audit](docs/INVENTORY-AUDIT.md) and [migration, backfill, and verification guide](docs/INVENTORY-IMPLEMENTATION.md) before rolling out the packaging changes. The Inventory screen now provides guided Add New Medicine and Add More Stock flows; POS supports independent tablet, strip, box and whole-item prices. Existing medicines require Owner packaging review.

## What is implemented

- Cookie-based Supabase SSR authentication with fresh `auth.getUser()` checks.
- Separate desktop navigation and app-style mobile bottom navigation.
- Role-specific dashboards; all financial metrics are calculated from database transactions.
- Search by medicine name, generic name, barcode, or SKU.
- Fast multi-item POS with cash/card payments, authorized discounts, idempotent checkout, and printable 80 mm/standard invoices.
- FEFO stock allocation with row locks; expired, quarantined, unavailable, and insufficient stock cannot be sold.
- Draft purchases and atomic posting into batch inventory.
- Owner-only stock correction with a mandatory reason and audit record.
- Audited direct POS returns for active Owners and Salespeople, including partial returns; historical return requests retain Owner review.
- Expense tracking, operational reports, salesperson performance, and safe CSV exports.
- Server-only Salesperson invitations and account deactivation.
- Responsive medicine cards and transaction cards instead of compressed mobile tables.

## Financial definitions

- **Revenue** = completed net sales after sale discounts, less approved refunds.
- **Gross profit** = revenue less recorded FEFO cost of goods sold, reversing returned medicine cost only when stock is received for resale.
- **Net operating result** = gross profit less recorded operating expenses.
- **Net Operating Profit** in Dashboard and Reports also subtracts net inventory losses after confirmed supplier recoveries and replacement stock. Supplier recoveries are separate from customer revenue.
- Draft purchases do not affect inventory or COGS.
- **Purchases received** counts posted purchase headers by receipt posting time within Asia/Karachi date boundaries, including recorded initial stock and restocks. It is separate from operating expenses. The purchase-invoice CSV uses invoice dates; the financial-summary CSV includes receipt-date purchases.

Purchase cost defaults and actual batch costs are held separately from the salesperson-readable medicine catalogue. `sale_item_costs`, `medicine_costs`, `medicine_batches`, purchases, suppliers, expenses, settings, and audit logs are protected by Owner-only RLS.

## Local setup

Prerequisites: Node.js 22+, npm, Docker Desktop, and the Supabase CLI.

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local`.

3. Start the local Supabase stack and reproduce the database:

   ```bash
   npm run db:start
   npm run db:reset
   ```

4. Copy the local project URL, publishable key, and secret key printed by Supabase into `.env.local`.

5. Create the one-time Owner account:

   ```bash
   npm run bootstrap:owner
   ```

   The script refuses to create a second Owner. It removes a partially created Auth account if profile/role provisioning fails.

6. Start Qeilvra:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000` and sign in. Use Inventory ? Add New Medicine to enter identification, initial stock and selling prices together. Use Add More Stock for later batches. Supplier invoice purchases remain available in Purchases.

## Hosted Supabase setup

1. Create a Supabase project and disable public email sign-up in Auth settings.
2. Configure the Site URL and allowed redirect URLs for `/auth/callback`.
3. Configure SMTP before inviting Salespeople or using password reset.
4. Link and push the reproducible migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

5. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `NEXT_PUBLIC_APP_URL` in the hosting provider.
6. Run `npm run bootstrap:owner` once against the hosted project.

Never expose `SUPABASE_SECRET_KEY` to client code. It is imported only by server actions and the bootstrap script.

## Verification

Static/unit checks:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Database policy and transaction tests (local Supabase must be running):

```bash
npm run db:test
```

The pgTAP suite verifies role resolution, cost isolation, price/role tampering denial, POS checkout, inventory deduction, duplicate submission, insufficient/expired stock rejection, refund authorization, and Owner reporting.

For real HTTP concurrency tests, set the following against a disposable test project before `npm test`:

```text
SUPABASE_TEST_URL=
SUPABASE_TEST_PUBLISHABLE_KEY=
SUPABASE_TEST_SECRET_KEY=
TEST_OWNER_EMAIL=
TEST_OWNER_PASSWORD=
TEST_SALESPERSON_EMAIL=
TEST_SALESPERSON_PASSWORD=
```

The integration test submits two simultaneous checkouts for the final unit and confirms exactly one succeeds. It also verifies direct API attempts cannot read costs or alter selling prices.

Browser tests:

```bash
npx playwright install chromium
npm run test:e2e
```

Set `E2E_SALESPERSON_EMAIL` and `E2E_SALESPERSON_PASSWORD` for authenticated navigation/POS tests. The Playwright matrix covers 320, 360, 390, 430, 768, 1024, and 1440 pixel widths.

## Deployment

Deploy the Next.js application to a Node-compatible platform such as Vercel. Apply migrations before deploying application code that depends on them. Recommended release order:

1. Back up the production database.
2. Run `supabase db push` and inspect the migration result.
3. Run database authorization tests against a staging project.
4. Deploy the Next.js build with production environment variables.
5. Smoke-test one Owner and one Salesperson session, including raw API denials.
6. Test a low-value POS transaction, invoice print, return request, and Owner refund.

The Content Security Policy, anti-framing, MIME-sniffing, referrer, and browser-permission headers are configured in `next.config.ts`.

## Architecture notes

- Server Components fetch private dashboard/table data and are forced dynamic within the authenticated shell.
- Client Components are limited to interactive workflows such as POS, charts, forms, drawers, and print controls.
- Checkout, purchase posting, stock adjustment, return approval, and medicine/cost saves are PostgreSQL functions so multi-table changes commit or roll back together.
- Security-definer functions use an empty pinned search path, schema-qualified objects, narrow execute grants, and explicit role checks.
- Invoice and purchase identifiers come from database sequences, not browser-generated counters.
- The checkout request carries a UUID idempotency key. Retrying the same request returns the existing sale.
- Search limits results, prioritizes exact barcode/SKU matches, and uses trigram indexes for names.
- Financial/user-specific responses use private/no-store behavior; stock is never placed in a shared cache.

## Production readiness boundary

The codebase, migrations, RLS, test suites, and integration points are complete, but a production deployment is not considered verified until migrations and role tests pass against the target Supabase project, SMTP is configured, receipt hardware is tested, and the browser suite passes with real Owner/Salesperson accounts. No credentials or fabricated financial records are included.

Hosted database release status and remaining on-site checks: [rollout report](docs/HOSTED-ROLLOUT.md).
