import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ q: z.string().trim().max(100), date: z.union([z.iso.date(), z.literal("")]), page: z.coerce.number().int().min(1).max(10000), sale: z.union([z.uuid(), z.literal("")]) })
    .safeParse({ q: params.get("q") ?? "", date: params.get("date") ?? "", page: params.get("page") ?? 1, sale: params.get("sale") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Check the search, date and page." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in again to view recent sales." }, { status: 401 });
  // Includes all earlier returns without changing the existing authorized sale scope.
  const { data, error } = await supabase.rpc("return_sales", { p_query: parsed.data.q, p_date: parsed.data.date || null, p_offset: (parsed.data.page - 1) * 10, p_limit: 11, p_sale_id: parsed.data.sale || null });
  if (error) return NextResponse.json({ error: "Could not load sales. Try again." }, { status: error.code === "42501" ? 403 : 503 });
  return NextResponse.json({ sales: (data ?? []).slice(0, 10), hasMore: (data ?? []).length > 10 }, { headers: { "Cache-Control": "private, no-store" } });
}
