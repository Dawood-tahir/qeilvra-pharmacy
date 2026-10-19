import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { validSalePrice } from "@/lib/sale-pricing";
import { isSameOriginMutation } from "@/lib/request-security";

const checkoutSchema = z.object({
  idempotencyKey: z.uuid(),
  items: z.array(z.object({ medicineId: z.uuid(), quantity: z.number().int().positive().max(100000), unitKey: z.enum(["base", "strip", "box"]), expectedPrice: z.string().refine(validSalePrice), customPrice: z.string().refine(validSalePrice).optional(), lineDiscount: z.number().nonnegative().max(999999999999.99).multipleOf(0.01).optional() })).min(1).max(100),
  paymentMethod: z.enum(["cash", "card"]),
  tenderedAmount: z.number().nonnegative().max(999999999999.99).multipleOf(0.01).nullable(),
  discount: z.number().nonnegative().max(999999999999.99).multipleOf(0.01).default(0),
  extraAmount: z.number().nonnegative().max(999999999.99).multipleOf(0.01).default(0),
  extraDescription: z.string().trim().max(120).default(""),
  cardConfirmed: z.boolean().optional(),
  customerName: z.string().trim().max(120).nullable().optional(),
  paymentReference: z.string().trim().max(120).nullable().optional(),
}).refine((data) => data.paymentMethod !== "card" || data.cardConfirmed === true, { message: "Confirm the external card payment." });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Open POS in Qeilvra to complete this sale." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Send the sale as JSON." }, { status: 415 });
  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the sale items and payment details." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const { data, error } = await supabase.rpc("checkout_sale", {
    // Legacy custom-price payloads are retained only for safe recovery of an already committed sale.
    // The database rejects custom prices on every new transaction.
    p_items: parsed.data.items.map((item) => ({ medicine_id: item.medicineId, quantity: item.quantity, unit_key: item.unitKey, expected_price: item.customPrice ?? item.expectedPrice, ...(item.customPrice ? { catalogue_price: item.expectedPrice, custom_price: item.customPrice } : {}), ...(item.lineDiscount !== undefined ? { line_discount: item.lineDiscount } : {}) })),
    p_payment_method: parsed.data.paymentMethod,
    p_tendered_amount: parsed.data.tenderedAmount,
    p_discount: parsed.data.discount,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_customer_name: parsed.data.customerName ?? null,
    p_payment_reference: parsed.data.paymentReference ?? null,
    p_extra_amount: parsed.data.extraAmount,
    p_extra_description: parsed.data.extraDescription || null,
  });
  if (error) {
    const safeMessage = /Only |expired|Discount|Cash received|Selling price|Custom price|Owner must confirm|selling unit/.test(error.message) ? error.message : "The sale could not be confirmed. Retry this sale to check its status.";
    return NextResponse.json({ error: safeMessage }, { status: error.code === "42501" ? 403 : /^(P0001|22|23|40)/.test(error.code ?? "") ? 409 : 503 });
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.sale_id || !result?.invoice_number) return NextResponse.json({ error: "The sale could not be confirmed. Retry this sale to check its status." }, { status: 503 });
  return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
}
