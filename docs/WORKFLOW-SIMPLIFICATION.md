# Workflow simplification audit — 18 October 2026

Scope: improve the existing interface, reuse saved suppliers, and preserve database operations, roles, calculations and packaging. No migrations or production deployment are needed.

| Workflow | Finding | Smallest useful improvement |
| --- | --- | --- |
| Dashboard | Period controls and chart hidden on mobile; amounts and explanations truncate | Make period selection accessible on all widths; compact chart and readable amounts |
| Add New Medicine | Guided flow already works; packaging result lacks the calculation context | Keep three steps and show the confirmed multiplication beside the stock total |
| Add More Stock | `supplier_id` is already accepted by validation and the receipt RPC, but never collected; review repeats disabled fields | Reuse active suppliers, searchable selection, dedicated review, retain request key on retries |
| Inventory | Main actions already clear; mobile expiry warnings less visible | Preserve table/cards and filters; emphasize expiry and total stock consistently |
| Purchases | Supplier selection is not searchable; fields lack reliable feedback; posting terminology is technical | Reuse supplier picker, label costs and totals, explain draft/post once, show posting result |
| Suppliers | Saved list lacks search; saves can silently fail | Search saved names and show confirmed save/error states |
| POS | Direct numeric entry exists but clearing it is awkward; product/cart cards waste vertical space | Allow temporary blank editing with validated commit; compact cards without shrinking touch controls |
| Receipts | History requires dashboard navigation; narrow toolbar crowds buttons | Link existing invoice history directly, wrap toolbar, retain print and price snapshots |
| Returns | Owner navigation omits existing Returns page; custom overlays lack focus handling; outcome omits stock decision | Add route links, reuse existing accessible dialog, show invoice and approved stock decision |
| Expenses | Some inputs use placeholders only; silent saves; purchase/expense distinction unclear | Visible labels, operating-cost guidance, confirmed success/error feedback |
| Reports | Jargon, hidden mobile chart and icon-only exports | Plain financial explanations, mobile chart, labeled CSV actions |
| Users | Form explains implementation details; failed edits can be silent | Explain invitation/access in plain language; preserve authorization and show results |
| Settings | Limits mixed with receipt identity; technical security wording | Group existing settings and show save feedback |
| Alerts / notifications | Technical introductions and inconsistent active state | Explain the next action and identify selected filter accessibly |

## Existing data path

`suppliers` already supplies active `id,name` pairs to Purchases. `receiveStockSchema` already accepts an optional UUID `supplier_id`; the authenticated Owner-only `receive_stock` RPC writes that ID into both `purchases` and `medicine_batches` within its existing transaction. Foreign keys validate identity. The receipt request key already prevents repeated stock posting. Selection must send this ID, never insert or synthesize a supplier. Keep the existing optional-supplier behavior, price reuse, stock arithmetic and posting behavior.

## Verification plan

Run TypeScript, lint, production build, existing unit/receipt tests, browser workflows at 320–1440px, and isolated PostgreSQL contracts. Extend coverage for saved-supplier selection and receipt links, same-key retry, direct quantity entry, purchase review, dialogs and form feedback. Use disposable fixtures only; do not add test transactions to the hosted pharmacy.
