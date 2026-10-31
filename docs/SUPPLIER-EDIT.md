# Editing supplier information

On `/suppliers/[id]`, **Edit Supplier** opens the existing native-dialog component beside the unchanged activation control. Owner and Manager use their authenticated Supabase session and the existing supplier RLS policy. This project has one pharmacy dataset; there is no tenant column to accept from the client.

The seven fields map directly to `public.suppliers.name`, `contact_person`, `phone`, `email`, `address`, `city`, and `tax_number`. `202610310021_supplier_city.sql` adds only nullable `city`; it has no data backfill, policy changes, or dependencies on the archive migrations. Apply and record this migration before deploying the updated profile loader. Do not use a blanket database push to install unrelated pending migrations.

The shared Zod schema validates the browser form and server action, strips unrecognized fields, trims surrounding whitespace, and stores empty optional fields as null. Name length follows the existing database constraint. Local and international phones retain formatting and optional extensions. Email must be complete when supplied. Multiline addresses and alphanumeric tax identifiers retain their internal formatting.

`updateSupplierAction` updates the existing supplier ID and requests the affected ID back before reporting success. It cannot change activation, creator, creation date, primary key, or transaction records. Successful saves invalidate the profile, supplier list, receiving forms, and purchase pages; the editor then refreshes the page and shows the confirmed-success toast. Failed saves retain all entries and permit retry. Repeating the same update does not create another supplier.

Phone, contact person, city, and tax registration are displayed under their own labels. Historical contact text is displayed as saved; phone numbers embedded in contact names are not guessed, split, or silently copied. Use the editor to correct a historical record deliberately.

Validation commands:

- `npx vitest run tests/unit/supplier-information.test.ts tests/unit/supplier-update.test.ts tests/unit/edit-supplier.test.tsx`
- `npm run test:database` includes real updates, Owner/Manager authorization, anonymous/Salesperson/inactive denials, unchanged supplier identity, and fingerprints of every related business table.
- `npx playwright test -c playwright.workflows.config.ts tests/workflows/supplier-edit.spec.ts tests/workflows/supplier-profile.spec.ts`
- `tests/e2e/supplier-edit.spec.ts` is an opt-in real-database test. Provide the public Supabase environment and `E2E_OWNER_EMAIL`/`E2E_OWNER_PASSWORD` and/or `E2E_MANAGER_EMAIL`/`E2E_MANAGER_PASSWORD`. It creates uniquely named temporary suppliers, checks the actual server action and browser refresh, and deletes only those fixtures afterward. Never commit credentials.

During implementation, migration `202610310021` was applied to the configured database; before/after schema and data-digest evidence is saved under ignored `.private/supplier-city-rollout/`. Other environments still need the additive migration before application deployment.

Files added or extended for this feature:

| Purpose | Files |
| --- | --- |
| Editor and profile presentation | `components/suppliers/edit-supplier.tsx`, `components/suppliers/supplier-profile.tsx` |
| Server update and validation | `app/(app)/suppliers/actions.ts`, `lib/supplier-information.ts` |
| Supplier model and retrieval | `lib/supplier-profile.ts`, `lib/supplier-profile-data.ts` |
| Additive schema change | `supabase/migrations/202610310021_supplier_city.sql` |
| Unit coverage | `tests/unit/edit-supplier.test.tsx`, `tests/unit/supplier-information.test.ts`, `tests/unit/supplier-update.test.ts` |
| Browser coverage and fixture wiring | `tests/workflows/supplier-edit.spec.ts`, `tests/e2e/supplier-edit.spec.ts`, `tests/ui/actions.ts` |
| PostgreSQL coverage and runner | `tests/database/supplier-information.sql`, `scripts/test-database.mjs` |
| Implementation and rollout notes | `docs/SUPPLIER-EDIT.md` |
