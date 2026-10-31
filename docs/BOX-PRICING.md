# Box-based medicine selling prices

For Tablet and Capsule medicines with confirmed strip and box quantities, Step 3 shows Box, Strip, then Tablet/Capsule. The box field is the required editable selling price; the other two are read-only and labelled “Auto-calculated from box price”. Calculations use the existing Step 2 quantities and update on every box-price or packaging change.

`lib/box-pricing.ts` converts the entered box price to integer paisa and divides directly by strips per box and total base units per box. BigInt half-up rounding matches positive PostgreSQL NUMERIC rounding. For 12 tablets per strip, 11 strips per box, and Rs. 1,320 per box, the strip and tablet prices are Rs. 120 and Rs. 10. A Rs. 100 box produces Rs. 9.09 per strip and Rs. 0.76 per tablet; the box remains Rs. 100. Neither calculation uses the rounded price of the other unit.

Empty, negative, zero, over-precision, exponential and non-finite price inputs clear the calculated fields. Packaging must contain positive whole counts within the existing stock-size limit. Saves reject a positive box price if either smaller price rounds to zero paisa. Existing per-unit selling-price limits are checked against the resulting prices.

The server action recalculates boxed medicine prices before schema validation and the existing atomic `save_guided_medicine` RPC. Submitted calculated prices are replaced; supplier IDs, purchase cost, batch, expiry, stock quantity and receipt retry keys retain their existing meanings. The existing `medicine_units.selling_price` rows store all three prices, and `medicines.selling_price` remains the base-unit price. No schema migration, new price column, or production data backfill is needed.

Editing an existing boxed medicine loads its saved box price and shows the calculated preview. If its independently saved prices differ, a warning lists those saved prices and explains that they remain unchanged until the box price is edited. A details-only save uses `pricing_mode: preserve`; the server reads current prices from the authenticated database session and retains them rather than trusting submitted prices. Changing box pricing or packaging adopts `pricing_mode: box`. New boxed medicines always derive prices, even if a caller submits a preserve flag. Existing packaging locks remain in force to protect stock conversions. Loose medicines, strips-only packs and sealed products retain the existing pricing flow.

Verification:

- `tests/unit/box-pricing.test.ts` checks the CAD 22 example, exact rounding, invalid input and minimum selling prices.
- `tests/unit/box-pricing-action.test.ts` checks server recomputation, altered client values, legacy preservation, authorization, limits and unchanged stock data.
- `tests/workflows/box-pricing.spec.ts` covers new/edit forms, field order, read-only prices, changing packaging, errors and explicit adoption of new prices.
- Existing supplier-receiving and inventory/POS browser workflows exercise the revised price entry without changing their other behavior.
- `scripts/test-box-pricing.mjs`, called by `npm run test:database`, imports the production calculator and runs actual PostgreSQL create, edit, reload, inventory search and POS checkout operations in a rolled-back transaction. It checks all three stored prices, historical invoice prices and fingerprints of stock, purchase, cost, supplier-related and financial records during price edits. No hosted transaction data is changed by this test.

Deploy the updated application to publish the feature. No new environment variables or database migrations are required for box pricing.
