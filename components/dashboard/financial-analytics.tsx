"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, ShoppingCart, PackagePlus, TrendingUp, ReceiptText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { financeRange, type FinancePeriod, type FinanceRange, type FinancialMetrics, type FinancialSnapshot } from "@/lib/financial-analytics";
import { cn, formatCurrency, formatDate, formatDateTime, localDateISO } from "@/lib/utils";

const ChartLoading = () => <div role="status" aria-label="Loading financial chart" className="skeleton h-60 rounded-xl sm:h-80" />;
const Trend = dynamic(() => import("./financial-charts").then(module => module.FinancialTrend), { ssr: false, loading: ChartLoading });
const Comparison = dynamic(() => import("./financial-charts").then(module => module.ExpensesProfitChart), { ssr: false, loading: ChartLoading });
const PurchasesComparison = dynamic(() => import("./financial-charts").then(module => module.SalesPurchasesChart), { ssr: false, loading: ChartLoading });
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
  const periodLabel = range.period === "today" ? "Today's" : range.period === "week" ? "This Week's" : range.period === "month" ? "This Month's" : "Period";
  const hasInventoryActivity = Boolean(metric.stock_written_off || metric.supplier_returns_value || metric.supplier_recoveries || metric.supplier_replacements_value);
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
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="q-segmented flex min-w-0 flex-wrap gap-1 rounded-xl border p-1" role="group" aria-label="Financial period">{presets.map(period => <button type="button" key={period.value} aria-pressed={range.period === period.value && !custom} disabled={loading} onClick={() => { setCustom(false); void load(financeRange(period.value)); }} className={cn("min-h-11 rounded-lg px-3 text-xs font-bold disabled:opacity-50", range.period === period.value && !custom ? "bg-white text-blue-700 shadow-sm" : "text-slate-600")}>{period.label}</button>)}{reports && <button type="button" aria-pressed={custom} className={cn("min-h-11 rounded-lg px-3 text-xs font-bold", custom ? "bg-white text-blue-700 shadow-sm" : "text-slate-600")} onClick={() => setCustom(true)}>Custom dates</button>}</div><Button variant="outline" size="sm" disabled={loading} onClick={() => void load(currentRange.current)}><RefreshCw className={cn("size-4", loading && "animate-spin")} />Refresh</Button></div>
    {reports && custom && <form aria-label="Date range" className="q-glass-secondary grid min-w-0 grid-cols-2 items-end gap-3 rounded-xl border p-3 sm:flex sm:flex-wrap" onSubmit={event => { event.preventDefault(); try { void load(financeRange("custom", start, end)); } catch (failure) { setError((failure as Error).message); } }}><label className="min-w-0 text-xs font-semibold">From<Input type="date" required value={start} max={end} onChange={event => setStart(event.target.value)} /></label><label className="min-w-0 text-xs font-semibold">To<Input type="date" required value={end} min={start} max={localDateISO()} onChange={event => setEnd(event.target.value)} /></label><Button className="col-span-2" variant="outline" disabled={loading}>Apply dates</Button><p className="text-xs text-slate-500">Up to one year</p></form>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><p>{formatDate(range.from + "T00:00:00+05:00")} – {formatDate(range.to + "T00:00:00+05:00")} · Asia/Karachi · PKR (Rs.)</p><p>Updated {formatDateTime(data.generated_at)} · refreshes every 30 seconds</p></div>
    {loading && <p role="status" className="text-sm text-blue-700">Loading financial figures…</p>}
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error} The last loaded figures remain below.</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void load(currentRange.current)}>Retry</Button></div>}
    <div aria-busy={loading} className={cn("space-y-4", loading && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Financial totals">
        <FinanceCard label={`${periodLabel} Sales`} value={formatCurrency(metric.revenue)} helper={`${metric.sales_count} completed transactions · after discounts and refunds`} negative={metric.revenue < 0} icon={ShoppingCart} />
        <FinanceCard label={`${periodLabel} Purchases`} value={data.purchases_total == null ? "Unavailable" : formatCurrency(data.purchases_total)} helper={`${data.purchases_count ?? 0} stock receipts · drafts excluded`} icon={PackagePlus} />
        <FinanceCard label={`${periodLabel} Gross Profit`} value={formatCurrency(metric.gross_profit)} helper="Revenue minus medicine cost" negative={metric.gross_profit < 0} icon={TrendingUp} />
        <FinanceCard label={`${periodLabel} Expenses`} value={formatCurrency(metric.expenses)} helper="Recorded operating costs" icon={ReceiptText} />
        <FinanceCard className="col-span-2 md:col-span-2 xl:col-span-1" label={`${periodLabel} Net Operating Profit`} value={formatCurrency(metric.net_operating_profit)} helper="After expenses and net inventory loss" negative={metric.net_operating_profit < 0} icon={Wallet} />
      </div>
      {(reports || hasInventoryActivity) && <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Inventory loss totals"><FinanceCard label="Expired/Damaged Stock Written Off" value={formatCurrency(metric.stock_written_off)} helper="Recorded batch purchase cost" /><FinanceCard label="Stock Value Returned to Suppliers" value={formatCurrency(metric.supplier_returns_value)} helper="Removed from stock at batch cost" /><FinanceCard label="Confirmed Supplier Refunds/Credits" value={formatCurrency(metric.supplier_recoveries)} helper="Pending amounts excluded" /><FinanceCard label="Net Inventory Loss" value={formatCurrency(metric.net_inventory_loss)} helper="After confirmed recoveries and replacements" negative={metric.net_inventory_loss > 0} /></div>}
      <Card surface="primary" className="min-w-0"><CardHeader><CardTitle>Revenue and Profit trend</CardTitle><p className="text-xs leading-5 text-slate-600">{range.granularity === "hour" ? "Hourly figures through the current hour." : "Daily figures for the selected dates."} Profit is before operating expenses and inventory losses.</p></CardHeader><CardContent>{noActivity && <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">No sales, refunds or expenses in this period.</p>}<Trend data={data.trend} hourly={range.granularity === "hour"} /><p className="mt-2 text-xs leading-5 text-slate-600">Selected period: {formatCurrency(metric.revenue)} revenue and {formatCurrency(metric.gross_profit)} gross profit. Inventory received: {data.purchases_total == null ? "unavailable" : formatCurrency(data.purchases_total)}; purchases are separate from running costs.</p></CardContent></Card>
      {reports && <>
        <div className="grid min-w-0 gap-4 xl:grid-cols-2"><Card surface="solid"><CardHeader><CardTitle>Financial summary</CardTitle><p className="text-xs text-slate-500">From medicine sales to money earned after running costs.</p></CardHeader><CardContent><dl className="divide-y divide-slate-100">{summary.map(row => <div key={row.key} className={cn("flex flex-wrap justify-between gap-x-3 gap-y-1 py-2.5 text-sm", row.key === "net_operating_profit" && "font-extrabold", Number(metric[row.key]) < 0 && row.key !== "cogs" && "text-red-700")}><dt className="min-w-0 flex-1 basis-40">{row.label}{row.key === "cogs" && metric.cogs < 0 && <span className="block text-xs text-emerald-700">Cost recovered from resale stock</span>}{row.helper && <span className="block text-xs font-normal text-slate-500">{row.helper}</span>}</dt><dd className="ml-auto font-semibold tabular-nums">{row.key === "cogs" && metric.cogs < 0 ? "+ " + formatCurrency(Math.abs(metric.cogs)) : <>{row.sign && Number(metric[row.key]) >= 0 ? row.sign + " " : ""}{formatCurrency(metric[row.key])}</>}</dd></div>)}</dl></CardContent></Card><div className="min-w-0 space-y-4"><Card surface="primary" className="min-w-0"><CardHeader><CardTitle>Expenses vs Profit</CardTitle><p className="text-xs leading-5 text-slate-600">Compare running costs with gross profit. Net Operating Profit subtracts expenses and net inventory losses once.</p></CardHeader><CardContent><Comparison data={data.daily} /><p className="mt-2 text-xs text-slate-600">{formatCurrency(metric.expenses)} operating expenses against {formatCurrency(metric.gross_profit)} gross profit.</p></CardContent></Card><Card surface="primary" className="min-w-0"><CardHeader><CardTitle>Sales vs Purchases</CardTitle><p className="text-xs leading-5 text-slate-600">Net sales revenue compared with stock received on posting dates. Stock purchases are inventory, not an operating loss.</p></CardHeader><CardContent><PurchasesComparison data={data.daily} /><p className="mt-2 text-xs text-slate-600">{formatCurrency(metric.revenue)} revenue · {data.purchases_total == null ? "Purchases unavailable" : `${formatCurrency(data.purchases_total)} received stock`}. Purchase invoices CSV uses invoice dates and includes drafts, so it may differ from posted receipts.</p></CardContent></Card></div></div>
        <div className="grid gap-4 xl:grid-cols-2"><Card><CardHeader><CardTitle>Best-selling medicines</CardTitle><p className="text-xs text-slate-500">Net base units sold after returns, across tablet, strip and box sales.</p></CardHeader><CardContent>{data.medicines.length ? <ol className="space-y-3">{data.medicines.map((medicine, index) => <li key={medicine.medicine_id} className="flex min-w-0 flex-wrap items-center gap-3 text-sm"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 font-bold text-blue-700">{index + 1}</span><span className="min-w-0 flex-1 break-words font-semibold">{medicine.medicine_name}</span><span className="text-xs">{medicine.quantity} {medicine.base_unit}{medicine.quantity === 1 ? "" : "s"}</span></li>)}</ol> : <p className="text-sm text-slate-500">No net medicine sales in this period.</p>}</CardContent></Card><Card><CardHeader><CardTitle>Expense categories</CardTitle></CardHeader><CardContent>{data.expense_categories.length ? <div className="space-y-4">{data.expense_categories.map(category => <div key={category.category}><div className="flex min-w-0 flex-wrap justify-between gap-2 text-sm"><span className="break-words">{category.category}</span><strong className="shrink-0">{formatCurrency(category.amount)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-50"><div className="h-full rounded-full bg-amber-400" style={{ width: `${metric.expenses ? Math.min(100, category.amount / metric.expenses * 100) : 0}%` }} /></div></div>)}</div> : <p className="text-sm text-slate-500">No operating expenses recorded.</p>}</CardContent></Card></div>
        <Card><CardHeader><CardTitle>Salesperson performance</CardTitle><p className="text-xs text-slate-500">Sales and completed refunds credited to the original cashier.</p></CardHeader><CardContent><div className="space-y-2">{data.salespeople?.length ? data.salespeople.map(person => <div key={person.id} className="q-inset-panel flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><span className="min-w-0 break-words font-semibold">{person.full_name}<span className="block text-xs font-normal text-slate-500">{person.sales_count} sales</span></span><strong className={cn("shrink-0", person.revenue < 0 && "text-red-700")}>{formatCurrency(person.revenue)}</strong></div>) : <p className="text-sm text-slate-500">No cashier activity in this period.</p>}</div><p className="mt-3 text-xs text-slate-500">Posted stock purchases: {formatCurrency(data.purchases_total)}. This is inventory received and is not deducted as an operating expense.</p></CardContent></Card>
        <Card surface="solid"><CardHeader><CardTitle>Daily sales summary</CardTitle><p className="text-xs text-slate-500">Purchase receipts are shown separately from expenses. Scroll the table to see all financial columns.</p></CardHeader><CardContent><div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Daily financial figures"><table className="w-full text-left text-xs sm:text-sm"><thead className="sticky top-0 bg-white text-slate-500"><tr>{["Date", "Sales", "Revenue", "Purchases received", "Gross Profit", "Expenses", "Inventory Loss", "Net Operating Profit"].map(label => <th scope="col" key={label} className="whitespace-nowrap p-2">{label}</th>)}</tr></thead><tbody>{data.daily.map(day => <tr key={day.sale_date} className="border-t border-slate-100"><td className="whitespace-nowrap p-2">{formatDate(day.bucket_start)}</td><td className="p-2">{day.sales_count}</td>{[day.revenue, day.purchases, day.gross_profit, day.expenses, day.net_inventory_loss, day.net_operating_profit].map((amount, index) => <td key={index} className={cn("whitespace-nowrap p-2 tabular-nums", Number(amount) < 0 && "font-semibold text-red-700")}>{amount == null ? "Unavailable" : formatCurrency(amount)}</td>)}</tr>)}</tbody></table></div></CardContent></Card>
        <div className="flex flex-wrap gap-2" aria-label="CSV exports">{["financials", "sales", "refunds", "returns", "expenses", "purchases", "inventory"].map(type => <a key={type} href={exportHref(type)} className="q-glass-secondary inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold text-blue-700 hover:border-blue-300"><Download className="size-4" />{type === "financials" ? "Financial summary" : type === "returns" ? "Return history" : type === "purchases" ? "Purchase invoices (invoice dates)" : type[0].toUpperCase() + type.slice(1)} CSV</a>)}</div>
      </>}
      <p className="text-xs leading-5 text-slate-500">Sales count on the sale date; refunds count on the date completed, including returns of earlier sales. Extra charges stay separate. Medicine cost uses recorded batch purchase costs and reverses only for resale stock. Stock purchases are inventory, not operating expenses. Inventory losses are separate from operating expenses and reduce Net Operating Profit once. Supplier recoveries are not customer sales. Replacement stock value is {formatCurrency(metric.supplier_replacements_value)}. Net Operating Profit includes recorded expenses; it is not complete accounting net profit.{data.legacy_cost_estimates > 0 && " Historical resale returns without batch allocations use their recorded average purchase cost."}</p>
    </div>
  </section>;
}

function FinanceCard({ label, value, helper, negative = false, icon: Icon, className }: { label: string; value: string; helper: string; negative?: boolean; icon?: typeof ShoppingCart; className?: string }) {
  return <Card surface="primary" className={cn("min-w-0 @container", negative && "border-red-200", className)}><CardContent className="p-3 sm:p-4"><div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words text-xs font-semibold leading-5 text-slate-600">{label}</p>{Icon && <Icon aria-hidden="true" className={cn("hidden size-4 shrink-0 sm:block", negative ? "text-red-600" : "text-blue-600")} />}</div><p className={cn("mt-2 overflow-x-auto whitespace-nowrap text-[clamp(0.75rem,6cqi,1.25rem)] font-extrabold tabular-nums", negative ? "text-red-700" : "text-slate-950")}>{value}</p><p className="mt-2 break-words text-[11px] leading-4 text-slate-600">{helper}</p></CardContent></Card>;
}
