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

Verification results and remaining limits are recorded here after the final code and browser checks. Browser workflow tests use isolated fixture aliases for authentication, Supabase and mutations. Database contracts create unique disposable databases on loopback PostgreSQL; they do not use production credentials.
