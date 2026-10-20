"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { financeRange, type FinancePeriod, type FinanceRange, type FinancialMetrics, type FinancialSnapshot } from "@/lib/financial-analytics";
import { cn, formatCurrency, formatDate, formatDateTime, localDateISO } from "@/lib/utils";

const ChartLoading = () => <div role="status" aria-label="Loading financial chart" className="skeleton h-60 rounded-xl sm:h-80" />;
const Trend = dynamic(() => import("./financial-charts").then(module => module.FinancialTrend), { ssr: false, loading: ChartLoading });
const Comparison = dynamic(() => import("./financial-charts").then(module => module.ExpensesProfitChart), { ssr: false, loading: ChartLoading });
const presets: { value: FinancePeriod; label: string }[] = [{ value: "today", label: "Today" }, { value: "week", label: "This Week" }, { value: "month", label: "This Month" }];

export function FinancialAnalytics({ initialData, initialRange, reports = false }: { initialData: FinancialSnapshot; initialRange: FinanceRange; reports?: boolean }) {
  const [data, setData] = useState(initialData);
  const [range, setRange] = useState(initialRange);
  const [custom, setCustom] = useState(initialRange.period === "custom");
  const [start, setStart] = useState(initialRange.from);
  const [end, setEnd] = useState(initialRange.to);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const lastAutomaticRefresh = useRef(0);
  const currentRange = useRef(initialRange);
  async function load(next: FinanceRange, background = false) {
    // Focus, online, visibility and the timer can fire together. Background
    // refreshes must never cancel an in-flight period selection or another refresh.
    if (background && (request.current || Date.now() - lastAutomaticRefresh.current < 1000)) return;
    lastAutomaticRefresh.current = Date.now();
    currentRange.current = next;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    if (!background) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/reports/analytics?" + new URLSearchParams({ period: next.period, from: next.from, to: next.to }), { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.metrics || !Array.isArray(result.trend)) throw new Error(result.error ?? "Financial figures could not load. Please retry.");
      if (controller.signal.aborted) return;
      setData(result); setRange(next); currentRange.current = next;
      const url = new URL(location.href); url.searchParams.set("period", next.period);
      if (next.period === "custom") { url.searchParams.set("from", next.from); url.searchParams.set("to", next.to); }
      else { url.searchParams.delete("from"); url.searchParams.delete("to"); }
      history.replaceState(null, "", url);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Financial figures could not load. Please retry."); }
    finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  const refresh = useRef(() => {});
  useEffect(() => {
    refresh.current = () => {
      if (document.visibilityState === "visible") {
        const active = currentRange.current;
        void load(active.period === "custom" ? active : financeRange(active.period), true);
      }
    };
    const timer = setInterval(() => refresh.current(), 30000);
    const handle = () => refresh.current();
    window.addEventListener("focus", handle); window.addEventListener("online", handle); document.addEventListener("visibilitychange", handle);
    return () => { clearInterval(timer); request.current?.abort(); window.removeEventListener("focus", handle); window.removeEventListener("online", handle); document.removeEventListener("visibilitychange", handle); };
  }, []);
  const metric = data.metrics;
  const summary: { label: string; key: keyof FinancialMetrics; sign?: string; helper?: string }[] = [
    { label: "Gross Sales", key: "gross_sales", helper: "Medicine sales before reductions" }, { label: "Discounts Given", key: "discounts", sign: "−" },
    { label: "Sales Refunds", key: "refunds", sign: "−" }, { label: "Net Medicine Revenue", key: "medicine_revenue" },
    { label: "Extra Charges Collected", key: "extra_charge_revenue", sign: "+" }, { label: "Total Revenue", key: "revenue" },
    { label: "Cost of Goods Sold", key: "cogs", sign: "−" }, { label: "Gross Profit", key: "gross_profit" },
    { label: "Operating Expenses", key: "expenses", sign: "−" },
    { label: "Expired/Damaged Stock Written Off", key: "stock_written_off", sign: "−" }, { label: "Stock Value Returned to Suppliers", key: "supplier_returns_value", sign: "−" }, { label: "Confirmed Supplier Refunds/Credits", key: "supplier_recoveries", sign: "+" }, { label: "Replacement Stock Received", key: "supplier_replacements_value", sign: "+" }, { label: "Net Inventory Loss", key: "net_inventory_loss" }, { label: "Net Operating Profit", key: "net_operating_profit" },
  ];
  const noActivity = metric.sales_count === 0 && metric.refunds === 0 && metric.expenses === 0 && !metric.stock_written_off && !metric.supplier_returns_value && !metric.supplier_recoveries && !metric.supplier_replacements_value;
  const exportHref = (type: string) => `/api/reports/export?${new URLSearchParams({ type, from: range.from, to: range.to })}`;
  return <section aria-label="Financial analytics" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Financial period">{presets.map(period => <button type="button" key={period.value} aria-pressed={range.period === period.value && !custom} disabled={loading} onClick={() => { setCustom(false); void load(financeRange(period.value)); }} className={cn("min-h-11 rounded-lg px-3 text-xs font-bold disabled:opacity-50", range.period === period.value && !custom ? "bg-white text-blue-700 shadow-sm" : "text-slate-600")}>{period.label}</button>)}{reports && <button type="button" aria-pressed={custom} className={cn("min-h-11 rounded-lg px-3 text-xs font-bold", custom ? "bg-white text-blue-700 shadow-sm" : "text-slate-600")} onClick={() => setCustom(true)}>Custom dates</button>}</div><Button variant="outline" size="sm" disabled={loading} onClick={() => void load(currentRange.current)}><RefreshCw className={cn("size-4", loading && "animate-spin")} />Refresh</Button></div>
    {reports && custom && <form aria-label="Date range" className="grid grid-cols-2 items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex sm:flex-wrap" onSubmit={event => { event.preventDefault(); try { void load(financeRange("custom", start, end)); } catch (failure) { setError((failure as Error).message); } }}><label className="min-w-0 text-xs font-semibold">From<Input type="date" required value={start} max={end} onChange={event => setStart(event.target.value)} /></label><label className="min-w-0 text-xs font-semibold">To<Input type="date" required value={end} min={start} max={localDateISO()} onChange={event => setEnd(event.target.value)} /></label><Button className="col-span-2" variant="outline" disabled={loading}>Apply dates</Button><p className="text-xs text-slate-500">Up to one year</p></form>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><p>{formatDate(range.from + "T00:00:00+05:00")} – {formatDate(range.to + "T00:00:00+05:00")} · Asia/Karachi · PKR (Rs.)</p><p>Updated {formatDateTime(data.generated_at)} · refreshes every 30 seconds</p></div>
    {loading && <p role="status" className="text-sm text-blue-700">Loading financial figures…</p>}
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error} The last loaded figures remain below.</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void load(currentRange.current)}>Retry</Button></div>}
    <div aria-busy={loading} className={cn("space-y-4", loading && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5" aria-label="Financial totals"><FinanceCard label="Total Sales" value={String(metric.sales_count)} helper="Completed transactions" /><FinanceCard label="Net Revenue" value={formatCurrency(metric.revenue)} helper="After discounts and refunds" negative={metric.revenue < 0} /><FinanceCard label="Gross Profit" value={formatCurrency(metric.gross_profit)} helper="Revenue minus medicine cost" negative={metric.gross_profit < 0} /><FinanceCard label="Operating Expenses" value={formatCurrency(metric.expenses)} helper="Recorded running costs" /><FinanceCard label="Net Operating Profit" value={formatCurrency(metric.net_operating_profit)} helper="After expenses and net inventory loss" negative={metric.net_operating_profit < 0} /></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Inventory loss totals"><FinanceCard label="Expired/Damaged Stock Written Off" value={formatCurrency(metric.stock_written_off)} helper="Recorded batch purchase cost" /><FinanceCard label="Stock Value Returned to Suppliers" value={formatCurrency(metric.supplier_returns_value)} helper="Removed from stock at batch cost" /><FinanceCard label="Confirmed Supplier Refunds/Credits" value={formatCurrency(metric.supplier_recoveries)} helper="Pending amounts excluded" /><FinanceCard label="Net Inventory Loss" value={formatCurrency(metric.net_inventory_loss)} helper="After confirmed recoveries and replacements" negative={metric.net_inventory_loss > 0} /></div>
      <Card className="min-w-0"><CardHeader><CardTitle>Revenue and Profit trend</CardTitle><p className="text-xs text-slate-500">{range.granularity === "hour" ? "Hourly figures through the current hour." : "Daily figures for the selected dates."} Profit is before operating expenses and inventory losses.</p></CardHeader><CardContent>{noActivity && <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">No sales, refunds or expenses in this period.</p>}<Trend data={data.trend} hourly={range.granularity === "hour"} /></CardContent></Card>
      {reports && <>
        <div className="grid min-w-0 gap-4 xl:grid-cols-2"><Card><CardHeader><CardTitle>Financial summary</CardTitle><p className="text-xs text-slate-500">From medicine sales to money earned after running costs.</p></CardHeader><CardContent><dl className="divide-y divide-slate-100">{summary.map(row => <div key={row.key} className={cn("flex justify-between gap-3 py-2.5 text-sm", row.key === "net_operating_profit" && "font-extrabold", Number(metric[row.key]) < 0 && row.key !== "cogs" && "text-red-700")}><dt>{row.label}{row.key === "cogs" && metric.cogs < 0 && <span className="block text-xs text-emerald-700">Cost recovered from resale stock</span>}{row.helper && <span className="block text-xs font-normal text-slate-500">{row.helper}</span>}</dt><dd className="shrink-0 font-semibold tabular-nums">{row.key === "cogs" && metric.cogs < 0 ? "+ " + formatCurrency(Math.abs(metric.cogs)) : <>{row.sign && Number(metric[row.key]) >= 0 ? row.sign + " " : ""}{formatCurrency(metric[row.key])}</>}</dd></div>)}</dl></CardContent></Card><Card className="min-w-0"><CardHeader><CardTitle>Expenses vs Profit</CardTitle><p className="text-xs text-slate-500">Compare running costs with gross profit. Net Operating Profit subtracts these expenses and net inventory losses once.</p></CardHeader><CardContent><Comparison data={data.daily} /></CardContent></Card></div>
        <div className="grid gap-4 xl:grid-cols-2"><Card><CardHeader><CardTitle>Best-selling medicines</CardTitle><p className="text-xs text-slate-500">Net base units sold after returns, across tablet, strip and box sales.</p></CardHeader><CardContent>{data.medicines.length ? <ol className="space-y-3">{data.medicines.map((medicine, index) => <li key={medicine.medicine_id} className="flex items-center gap-3 text-sm"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 font-bold text-blue-700">{index + 1}</span><span className="min-w-0 flex-1 break-words font-semibold">{medicine.medicine_name}</span><span className="text-xs">{medicine.quantity} {medicine.base_unit}{medicine.quantity === 1 ? "" : "s"}</span></li>)}</ol> : <p className="text-sm text-slate-500">No net medicine sales in this period.</p>}</CardContent></Card><Card><CardHeader><CardTitle>Expense categories</CardTitle></CardHeader><CardContent>{data.expense_categories.length ? <div className="space-y-4">{data.expense_categories.map(category => <div key={category.category}><div className="flex justify-between gap-2 text-sm"><span className="break-words">{category.category}</span><strong className="shrink-0">{formatCurrency(category.amount)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-50"><div className="h-full rounded-full bg-amber-400" style={{ width: `${metric.expenses ? Math.min(100, category.amount / metric.expenses * 100) : 0}%` }} /></div></div>)}</div> : <p className="text-sm text-slate-500">No operating expenses recorded.</p>}</CardContent></Card></div>
        <Card><CardHeader><CardTitle>Salesperson performance</CardTitle><p className="text-xs text-slate-500">Sales and completed refunds credited to the original cashier.</p></CardHeader><CardContent><div className="space-y-2">{data.salespeople?.length ? data.salespeople.map(person => <div key={person.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm"><span className="min-w-0 break-words font-semibold">{person.full_name}<span className="block text-xs font-normal text-slate-500">{person.sales_count} sales</span></span><strong className={cn("shrink-0", person.revenue < 0 && "text-red-700")}>{formatCurrency(person.revenue)}</strong></div>) : <p className="text-sm text-slate-500">No cashier activity in this period.</p>}</div><p className="mt-3 text-xs text-slate-500">Posted stock purchases: {formatCurrency(data.purchases_total)}. This is inventory received and is not deducted as an operating expense.</p></CardContent></Card>
        <Card><CardHeader><CardTitle>Daily sales summary</CardTitle></CardHeader><CardContent><div className="max-h-96 overflow-auto"><table className="w-full text-left text-xs sm:text-sm"><thead className="sticky top-0 bg-white text-slate-500"><tr>{["Date", "Sales", "Revenue", "Gross Profit", "Expenses", "Inventory Loss", "Net Operating Profit"].map(label => <th key={label} className="whitespace-nowrap p-2">{label}</th>)}</tr></thead><tbody>{data.daily.map(day => <tr key={day.sale_date} className="border-t border-slate-100"><td className="whitespace-nowrap p-2">{formatDate(day.bucket_start)}</td><td className="p-2">{day.sales_count}</td>{[day.revenue, day.gross_profit, day.expenses, day.net_inventory_loss, day.net_operating_profit].map((amount, index) => <td key={index} className={cn("whitespace-nowrap p-2 tabular-nums", amount < 0 && "font-semibold text-red-700")}>{formatCurrency(amount)}</td>)}</tr>)}</tbody></table></div></CardContent></Card>
        <div className="flex flex-wrap gap-2" aria-label="CSV exports">{["financials", "sales", "refunds", "returns", "expenses", "purchases", "inventory"].map(type => <a key={type} href={exportHref(type)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold capitalize text-blue-700"><Download className="size-4" />{type === "financials" ? "Financial summary" : type === "returns" ? "Return history" : type} CSV</a>)}</div>
      </>}
      <p className="text-xs leading-5 text-slate-500">Sales count on the sale date; refunds count on the date completed, including returns of earlier sales. Extra charges stay separate. Medicine cost uses recorded batch purchase costs and reverses only for resale stock. Stock purchases are inventory, not operating expenses. Inventory losses are separate from operating expenses and reduce Net Operating Profit once. Supplier recoveries are not customer sales. Replacement stock value is {formatCurrency(metric.supplier_replacements_value)}. Net Operating Profit includes recorded expenses; it is not complete accounting net profit.{data.legacy_cost_estimates > 0 && " Historical resale returns without batch allocations use their recorded average purchase cost."}</p>
    </div>
  </section>;
}

function FinanceCard({ label, value, helper, negative = false }: { label: string; value: string; helper: string; negative?: boolean }) {
  return <Card className={cn("min-w-0", negative && "border-red-200 bg-red-50")}><CardContent className="p-3 sm:p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className={cn("mt-2 break-words text-lg font-extrabold tabular-nums sm:text-xl", negative ? "text-red-700" : "text-slate-950")}>{value}</p><p className="mt-2 text-[10px] leading-4 text-slate-500">{helper}</p></CardContent></Card>;
}
