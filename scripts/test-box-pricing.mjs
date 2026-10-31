import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Called only by the guarded, disposable localhost PostgreSQL test runner.
// This imports the production calculator; no hosted credentials or network calls.
export async function verifyBoxPricingDatabase(db, sql, quote) {
  const { deriveBoxPricingInput } = await import("../lib/box-pricing.ts");
  const identity = { name: "CAD 22 pricing contract", dosage_form: "Tablet", strength: "22mg", barcode: "BOX-PRICING-CONTRACT", manufacturer: "", generic_name: "", tablets_per_strip: 12, strips_per_box: 11 };
  const input = price => ({ ...identity, units: [
    { unit_key: "base", selling_price: "9999", max_price: null },
    { unit_key: "strip", selling_price: "9999", max_price: null },
    { unit_key: "box", selling_price: price, max_price: null },
  ] });
  const created = deriveBoxPricingInput(input("1320"));
  const edited = deriveBoxPricingInput(input("2640"));
  assert.ok(created.ok && edited.ok);
  const json = value => quote(JSON.stringify(value)) + "::jsonb";
  const supplier = randomUUID();
  const stock = { unit_key: "box", quantity: 2, batch_number: "CAD22-BATCH", expiry_date: "2099-12-25", total_cost: "1000", supplier_id: supplier };
  const unchangedTables = ["purchases", "purchase_items", "medicine_batches", "medicine_costs", "stock_movements", "stock_receipts", "sales", "sale_items", "payments", "sale_returns", "return_items", "return_allocations", "sale_item_costs"];
  const fingerprint = "jsonb_build_object(" + unchangedTables.map(table => quote(table) + ", (select md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) from public." + table + " t)").join(",") + ")";
  sql(db, `begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.suppliers(id,name,created_by) values(${quote(supplier)},'Box pricing test supplier','10000000-0000-0000-0000-000000000001');
create temp table box_created as select public.save_guided_medicine(null,${json(created.data)},${json(stock)},${quote(randomUUID())}) result;
select public.test_assert((select (result->>'quantity')::integer=264 from box_created),'box pricing creates the actual 264-tablet initial receipt');
select public.test_assert((select jsonb_object_agg(unit_key,selling_price)='{"base":10,"strip":120,"box":1320}'::jsonb from public.medicine_units where medicine_id=(select (result->>'id')::uuid from box_created)),'all three server-calculated prices persist in existing medicine_units');
select public.test_assert((select selling_price=10 and tablets_per_strip=12 and strips_per_box=11 from public.medicines where id=(select (result->>'id')::uuid from box_created)),'medicine base-price display and packaging match the saved units');
select public.test_assert((select total=1000 and supplier_id=${quote(supplier)}::uuid from public.purchases where id=(select (result->>'purchase_id')::uuid from box_created)),'purchase cost and supplier identity stay separate from selling prices');
create temp table box_first_sale as select sale_id from public.checkout_sale(jsonb_build_array(
 jsonb_build_object('medicine_id',(select result->>'id' from box_created),'unit_key','base','quantity',1),
 jsonb_build_object('medicine_id',(select result->>'id' from box_created),'unit_key','strip','quantity',1),
 jsonb_build_object('medicine_id',(select result->>'id' from box_created),'unit_key','box','quantity',1)
),'cash',1450,0,${quote(randomUUID())});
select public.test_assert((select net_total=1450 from public.sales where id=(select sale_id from box_first_sale)),'POS charges 10 + 120 + 1320 for the actual tablet, strip and box');
select public.test_assert((select jsonb_object_agg(unit_label,unit_price)='{"tablet":10,"strip":120,"box":1320}'::jsonb from public.sale_items where sale_id=(select sale_id from box_first_sale)),'completed invoice snapshots retain each calculated selling price');
create temp table box_before_edit as select ${fingerprint} snapshot;
select public.save_guided_medicine((select (result->>'id')::uuid from box_created),${json(edited.data)},null,${quote(randomUUID())});
select public.test_assert((select ${fingerprint}=snapshot from box_before_edit),'price editing leaves stock, purchase history, supplier links, costs, completed invoices and returns unchanged');
select public.test_assert((select jsonb_object_agg(unit_key,selling_price)='{"base":20,"strip":240,"box":2640}'::jsonb from public.medicine_units where medicine_id=(select (result->>'id')::uuid from box_created)),'edited prices persist and reload through the existing unit rows');
select public.test_assert((select selling_price=20 and available_quantity=119 from public.search_sellable_medicines('BOX-PRICING-CONTRACT')),'inventory and POS search reload updated prices without changing available stock');
create temp table box_second_sale as select sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select result->>'id' from box_created),'unit_key','strip','quantity',1)),'cash',240,0,${quote(randomUUID())});
select public.test_assert((select net_total=240 from public.sales where id=(select sale_id from box_second_sale)),'new POS sales use the edited strip price');
select public.test_assert((select net_total=1450 from public.sales where id=(select sale_id from box_first_sale)),'editing prices never rewrites the completed historical invoice');
rollback;`);
  console.log("PASS: production box-price calculator creates/edits real PostgreSQL prices, reloads inventory, charges POS correctly and preserves stock/cost/history during edits");
}
