import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!/^[a-zA-Z0-9-]{3,80}$/.test(query)) return NextResponse.json({ error: "Enter an invoice number (at least three characters)." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again to find invoices." }, { status: 401 });
  // The existing RLS policies restrict Salespeople to their own invoices and return requests.
  const { data, error } = await supabase.from("sales").select("id,invoice_number,subtotal,net_total,sale_items(id,medicine_name,quantity,unit_label,unit_price,net_line_total),sale_returns(id,status,return_items(id,sale_item_id,quantity,approved_quantity))")
    .ilike("invoice_number", "%" + query + "%").order("completed_at", { ascending: false }).limit(6);
  if (error) return NextResponse.json({ error: "Could not load invoices. Try again." }, { status: 503 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
