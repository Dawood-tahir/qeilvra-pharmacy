import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = z.object({ q: z.string().trim().max(100).default(""), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse({ q: url.searchParams.get("q") ?? "", limit: url.searchParams.get("limit") ?? 20 });
  if (!parsed.success) return NextResponse.json({ error: "Invalid search" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.rpc("inventory_search", { p_query: parsed.data.q, p_limit: parsed.data.limit });
  if (error) return NextResponse.json({ error: "Medicine search failed." }, { status: 400 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
