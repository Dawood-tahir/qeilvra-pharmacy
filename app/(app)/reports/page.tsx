import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { financeRange, type FinancialSnapshot } from "@/lib/financial-analytics";
import { FinancialAnalytics } from "@/components/dashboard/financial-analytics";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  await requireOwner();
  const params = await searchParams;
  const range = financeRange(params.from || params.to ? "custom" : params.period ?? "month", params.from, params.to);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("owner_financial_analytics", { p_from: range.from, p_to: range.to, p_granularity: range.granularity });
  if (error || !data?.metrics) throw new Error("Financial reports could not be loaded. Please retry.");
  return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><div className="mb-5"><p className="text-sm font-semibold text-blue-700">Owner financials</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Reports</h1><p className="mt-1 text-sm text-slate-500">Understand sales, medicine costs and running expenses in one place.</p></div><FinancialAnalytics initialData={data as FinancialSnapshot} initialRange={range} reports /></main>;
}
