import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const query = z.string().trim().min(2).max(100).safeParse(new URL(request.url).searchParams.get("q"));
  if (!query.success) return NextResponse.json([]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [medicineResult, saleResult] = await Promise.all([
    supabase.rpc("search_sellable_medicines", { p_query: query.data, p_limit: 8 }),
    supabase.from("sales").select("id,invoice_number,net_total,completed_at").ilike("invoice_number", `%${query.data}%`).order("completed_at", { ascending: false }).limit(5),
  ]);
  if (medicineResult.error || saleResult.error) return NextResponse.json({ error: "Search could not load. Please try again." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const medicines = (medicineResult.data ?? []).map((item: Record<string, unknown>) => ({ id: item.id, type: "medicine", title: item.name, subtitle: [item.generic_name, item.strength, item.sku].filter(Boolean).join(" · "), meta: String(item.selling_price) }));
  const sales = (saleResult.data ?? []).map((item: Record<string, unknown>) => ({ id: item.id, type: "invoice", title: item.invoice_number, subtitle: new Date(item.completed_at as string).toLocaleString("en-PK", { timeZone: "Asia/Karachi" }), meta: `Rs. ${Number(item.net_total).toLocaleString("en-PK")}` }));
  return NextResponse.json([...medicines, ...sales], { headers: { "Cache-Control": "private, no-store" } });
}
