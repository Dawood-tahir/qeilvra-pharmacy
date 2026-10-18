import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const checkoutSchema = z.object({
  idempotencyKey: z.uuid(),
  items: z.array(z.object({ medicineId: z.uuid(), quantity: z.number().int().positive().max(100000), unitKey: z.enum(["base", "strip", "box"]), expectedPrice: z.string().regex(/^\d+(\.\d{1,2})?$/) })).min(1).max(100),
  paymentMethod: z.enum(["cash", "card"]),
  tenderedAmount: z.number().nonnegative().nullable(),
  discount: z.number().nonnegative().default(0),
  customerName: z.string().trim().max(120).nullable().optional(),
  paymentReference: z.string().trim().max(120).nullable().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the sale items and payment details." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const { data, error } = await supabase.rpc("checkout_sale", {
    p_items: parsed.data.items.map((item) => ({ medicine_id: item.medicineId, quantity: item.quantity, unit_key: item.unitKey, expected_price: item.expectedPrice })),
    p_payment_method: parsed.data.paymentMethod,
    p_tendered_amount: parsed.data.tenderedAmount,
    p_discount: parsed.data.discount,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_customer_name: parsed.data.customerName ?? null,
    p_payment_reference: parsed.data.paymentReference ?? null,
  });
  if (error) {
    const safeMessage = error.message.includes("Only ") || error.message.includes("expired") || error.message.includes("Discount") || error.message.includes("Cash received") || error.message.includes("Selling prices changed") || error.message.includes("Owner must confirm") || error.message.includes("selling unit") ? error.message : "The sale could not be confirmed. Retry this sale to check its status.";
    return NextResponse.json({ error: safeMessage }, { status: error.code === "42501" ? 403 : /^(P0001|22|23|40)/.test(error.code ?? "") ? 409 : 503 });
  }
  return NextResponse.json(Array.isArray(data) ? data[0] : data, { status: 201, headers: { "Cache-Control": "no-store" } });
}
