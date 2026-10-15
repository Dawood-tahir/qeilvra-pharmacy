import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const env = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  secret: process.env.SUPABASE_TEST_SECRET_KEY,
  ownerEmail: process.env.TEST_OWNER_EMAIL,
  ownerPassword: process.env.TEST_OWNER_PASSWORD,
  salespersonEmail: process.env.TEST_SALESPERSON_EMAIL,
  salespersonPassword: process.env.TEST_SALESPERSON_PASSWORD,
};
const configured = Object.values(env).every(Boolean);

describe.skipIf(!configured)("real Supabase role and concurrency contracts", () => {
  it("enforces cost privacy and serializes competing checkout", async () => {
    const owner = createClient(env.url!, env.key!, { auth: { persistSession: false } });
    const salesperson = createClient(env.url!, env.key!, { auth: { persistSession: false } });
    const admin = createClient(env.url!, env.secret!, { auth: { persistSession: false } });
    expect((await owner.auth.signInWithPassword({ email: env.ownerEmail!, password: env.ownerPassword! })).error).toBeNull();
    expect((await salesperson.auth.signInWithPassword({ email: env.salespersonEmail!, password: env.salespersonPassword! })).error).toBeNull();

    const marker = crypto.randomUUID().slice(0, 8);
    const { data: ownerUser } = await owner.auth.getUser();
    const { data: medicineId, error: medicineError } = await owner.rpc("save_medicine", {
      p_medicine_id: null,
      p_data: { name: `Concurrency Test ${marker}`, generic_name: "", manufacturer: "", category_id: "", strength: "", dosage_form: "tablet", barcode: "", sku: `CONC-${marker}`, purchase_price: 10, selling_price: 20, reorder_level: 1, base_unit: "tablet", units_per_pack: 1, is_active: true },
    });
    expect(medicineError).toBeNull();
    const { data: batch, error: batchError } = await admin.from("medicine_batches").insert({ medicine_id: medicineId, batch_number: `B-${marker}`, expiry_date: "2099-12-31", quantity_on_hand: 1, purchase_cost: 10 }).select("id").single();
    expect(batchError).toBeNull();

    const { data: leakedCosts } = await salesperson.from("medicine_costs").select("default_purchase_cost").eq("medicine_id", medicineId);
    expect(leakedCosts).toEqual([]);
    await salesperson.from("medicines").update({ selling_price: 1 }).eq("id", medicineId);
    const { data: unchanged } = await owner.from("medicines").select("selling_price").eq("id", medicineId).single();
    expect(Number(unchanged?.selling_price)).toBe(20);

    const checkout = (key: string) => salesperson.rpc("checkout_sale", { p_items: [{ medicine_id: medicineId, quantity: 1 }], p_payment_method: "cash", p_tendered_amount: 20, p_discount: 0, p_idempotency_key: key, p_customer_name: null, p_payment_reference: null });
    const [first, second] = await Promise.all([checkout(crypto.randomUUID()), checkout(crypto.randomUUID())]);
    expect([first.error, second.error].filter(Boolean)).toHaveLength(1);
    expect([first.data, second.data].filter(Boolean)).toHaveLength(1);

    const duplicateKey = crypto.randomUUID();
    await admin.from("medicine_batches").update({ quantity_on_hand: 1 }).eq("id", batch!.id);
    const original = await checkout(duplicateKey);
    const duplicate = await checkout(duplicateKey);
    expect(original.error).toBeNull();
    expect(duplicate.error).toBeNull();
    expect(duplicate.data?.[0]?.sale_id).toBe(original.data?.[0]?.sale_id);
    expect(ownerUser.user).toBeTruthy();
  }, 30_000);
});
