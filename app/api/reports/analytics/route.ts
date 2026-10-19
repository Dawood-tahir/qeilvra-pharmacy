import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { financeRange } from "@/lib/financial-analytics";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let range;
  try { range = financeRange(params.get("period") ?? "today", params.get("from") ?? undefined, params.get("to") ?? undefined); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in again to view financial reports." }, { status: 401 });
  // The RPC checks active Owner authorization before reading financial rows.
  // Keeping the role check in the same database operation avoids another round trip.
  const started = performance.now();
  const { data, error } = await supabase.rpc("owner_financial_analytics", { p_from: range.from, p_to: range.to, p_granularity: range.granularity });
  if (error?.code === "42501") return NextResponse.json({ error: "Owner permission required." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  if (error || !data?.metrics) return NextResponse.json({ error: "Financial figures could not load. Please retry." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store", "Server-Timing": `analytics;dur=${(performance.now() - started).toFixed(1)}` } });
}
