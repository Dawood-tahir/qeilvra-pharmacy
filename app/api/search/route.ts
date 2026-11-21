import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { textSearchFilter } from "@/lib/live-search";

const MEDICINE_LIMIT = 8;
const INVOICE_LIMIT = 5;

export async function GET(request: Request) {
  const query = z.string().trim().max(100).safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!query.success) return NextResponse.json([]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let medicinesQuery = supabase.from("medicines").select("id,name,generic_name,strength,sku,barcode,selling_price")
    .eq("is_active", true).order("name").order("id").limit(MEDICINE_LIMIT + 1);
  let invoicesQuery = supabase.from("sales").select("id,invoice_number,net_total,completed_at")
    .order("completed_at", { ascending: false }).order("id", { ascending: false }).limit(INVOICE_LIMIT + 1);
  if (query.data) {
    medicinesQuery = medicinesQuery.or(textSearchFilter(query.data, "name", "generic_name", "sku", "barcode"));
    invoicesQuery = invoicesQuery.or(textSearchFilter(query.data, "invoice_number"));
  }
  const [medicineResult, saleResult] = await Promise.all([medicinesQuery, invoicesQuery]);
  if (medicineResult.error || saleResult.error) return NextResponse.json({ error: "Search could not load. Please try again." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });

  const medicineRows = medicineResult.data ?? [];
  const saleRows = saleResult.data ?? [];
  const medicines = medicineRows.slice(0, MEDICINE_LIMIT).map((item) => ({
    id: item.id, type: "medicine", title: item.name, subtitle: [item.generic_name, item.strength, item.sku].filter(Boolean).join(" · "),
    meta: String(item.selling_price), fields: [item.name, item.generic_name, item.sku, item.barcode],
  }));
  const sales = saleRows.slice(0, INVOICE_LIMIT).map((item) => ({
    id: item.id, type: "invoice", title: item.invoice_number, fields: [item.invoice_number],
    subtitle: new Date(item.completed_at).toLocaleString("en-PK", { timeZone: "Asia/Karachi" }),
    meta: "Rs. " + Number(item.net_total).toLocaleString("en-PK"),
  }));
  return NextResponse.json([...medicines, ...sales], { headers: {
    "Cache-Control": "private, no-store",
    "X-Search-Complete": String(medicineRows.length <= MEDICINE_LIMIT && saleRows.length <= INVOICE_LIMIT),
  } });
}
