"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  ArrowUpRight, BarChart3, Boxes, CalendarDays, ChevronRight, CircleAlert, Clock3, PackagePlus,
  Pill, Plus, ReceiptText, ShoppingCart, TrendingUp, TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SalesChart, type TrendPoint } from "@/components/dashboard/sales-chart";
import { cn, formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import type { AppRole } from "@/lib/auth";

type Metrics = {
  today_sales?: number;
  today_transactions?: number;
  revenue?: number;
  gross_profit?: number;
  expenses?: number;
  net_operating_result?: number;
  sales_count?: number;
  total_medicines?: number;
  low_stock_items?: number;
  out_of_stock_items?: number;
  expiring_items?: number;
};
type Alert = { medicine_id: string; medicine_name: string; strength?: string; available_quantity: number; reorder_level: number; expiry_date?: string; alert_kind: string; days_until_expiry?: number };
type RecentSale = { id: string; invoice_number: string; net_total: number; completed_at: string; status: string; item_count: number; payment_method?: string };

function KpiCard({ title, value, helper, icon: Icon, tone = "blue" }: { title: string; value: string; helper: string; icon: typeof ShoppingCart; tone?: "blue" | "green" | "orange" | "red" }) {
  const styles = { blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", orange: "bg-orange-50 text-orange-700", red: "bg-red-50 text-red-700" };
  return <Card className="min-w-0"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-500 sm:text-sm">{title}</p><p className="mt-1 truncate text-xl font-extrabold tracking-tight text-slate-950 sm:text-2xl tabular-nums">{value}</p></div><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", styles[tone])}><Icon className="size-5" /></span></div><p className="mt-3 truncate text-[11px] text-slate-500 sm:text-xs">{helper}</p></CardContent></Card>;
}

export function DashboardView({ role, name, metrics, todaySales, trend, lowStock, expiring, recentSales, period }: { role: AppRole; name: string; metrics: Metrics; todaySales: number; trend: TrendPoint[]; lowStock: Alert[]; expiring: Alert[]; recentSales: RecentSale[]; period: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const firstName = name.split(" ")[0];
  const owner = role === "owner";
  const periods = useMemo(() => [{ id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "month", label: "This month" }], []);
  const setPeriod = (value: string) => { const params = new URLSearchParams(searchParams); params.set("period", value); router.replace(`/dashboard?${params}`); };

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div><p className="text-sm font-semibold text-blue-700">{owner ? "Owner overview" : "Counter workspace"}</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">Welcome back, {firstName}</h1><p className="mt-1 text-sm text-slate-500">{owner ? "Here’s how your pharmacy is performing." : "Everything you need for a fast, accurate sale."}</p></div>
        <p className="hidden items-center gap-2 text-xs font-medium text-slate-500 sm:flex"><CalendarDays className="size-4" /> {formatDate(new Date())}</p>
      </div>

      {!owner && <Link href="/pos" className="mb-4 flex min-h-16 items-center justify-between rounded-2xl bg-gradient-to-r from-blue-700 to-blue-500 p-4 text-white shadow-lg shadow-blue-200"><span className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-white/15"><ShoppingCart /></span><span><span className="block text-lg font-bold">Start a new sale</span><span className="block text-xs text-blue-100">Search, scan and checkout</span></span></span><ArrowUpRight /></Link>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Key performance indicators">
        {owner ? <>
          <KpiCard title="Today's Sales" value={formatCurrency(todaySales)} helper="Net of discounts and approved returns" icon={ShoppingCart} tone="green" />
          <KpiCard title="Total Revenue" value={formatCurrency(metrics.revenue)} helper="Selected period · not profit" icon={TrendingUp} />
          <KpiCard title="Total Medicines" value={String(metrics.total_medicines ?? 0)} helper="Active catalogue items" icon={Pill} tone="orange" />
          <KpiCard title="Low Stock Items" value={String(metrics.low_stock_items ?? 0)} helper={`${metrics.out_of_stock_items ?? 0} unavailable`} icon={TriangleAlert} tone="red" />
        </> : <>
          <KpiCard title="My Sales Today" value={formatCurrency(metrics.today_sales)} helper={`${metrics.today_transactions ?? 0} transactions`} icon={ShoppingCart} tone="green" />
          <KpiCard title="Low Stock" value={String(metrics.low_stock_items ?? 0)} helper="Items needing attention" icon={TriangleAlert} tone="orange" />
          <KpiCard title="Unavailable" value={String(metrics.out_of_stock_items ?? 0)} helper="Out of stock medicines" icon={Boxes} tone="red" />
          <KpiCard title="Quick Search" value="Medicines" helper="View prices, stock and expiry" icon={Pill} />
        </>}
      </section>

      {owner && <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,.65fr)]">
        <Card className="hidden md:block"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><BarChart3 className="size-5 text-blue-600" /> Sales & Revenue Overview</CardTitle><p className="mt-1 text-xs text-slate-500">Revenue is net sales; green is gross profit before expenses.</p></div><div className="flex rounded-xl bg-slate-100 p-1">{periods.map((item) => <button key={item.id} onClick={() => setPeriod(item.id)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", period === item.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}>{item.label}</button>)}</div></CardHeader><CardContent><SalesChart data={trend} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="size-5 text-blue-600" /> Stock Status</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xl font-extrabold text-emerald-700">{Math.max((metrics.total_medicines ?? 0) - (metrics.low_stock_items ?? 0) - (metrics.out_of_stock_items ?? 0), 0)}</p><p className="mt-1 text-[10px] font-semibold text-emerald-700">In stock</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xl font-extrabold text-amber-700">{metrics.low_stock_items ?? 0}</p><p className="mt-1 text-[10px] font-semibold text-amber-700">Low</p></div><div className="rounded-xl bg-red-50 p-3"><p className="text-xl font-extrabold text-red-700">{metrics.out_of_stock_items ?? 0}</p><p className="mt-1 text-[10px] font-semibold text-red-700">Out</p></div></div><div className="rounded-xl border border-slate-100 p-3"><div className="flex justify-between text-sm"><span className="text-slate-500">Gross profit</span><strong>{formatCurrency(metrics.gross_profit)}</strong></div><div className="mt-2 flex justify-between text-sm"><span className="text-slate-500">Expenses</span><strong className="text-red-600">{formatCurrency(metrics.expenses)}</strong></div><div className="mt-3 flex justify-between border-t pt-3"><span className="font-semibold">Operating result</span><strong className={(metrics.net_operating_result ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}>{formatCurrency(metrics.net_operating_result)}</strong></div></div></CardContent></Card>
      </div>}

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <AlertCard title="Low Stock" icon={TriangleAlert} items={lowStock} href="/alerts?filter=low_stock" />
        <AlertCard title="Expiring Soon" icon={Clock3} items={expiring} href="/alerts?filter=expiring" expiry />
      </section>

      {owner && <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Quick actions">
        {[{ label: "New Sale", href: "/pos", icon: ShoppingCart, color: "bg-emerald-50 text-emerald-700" }, { label: "Add Medicine", href: "/medicines/new", icon: Plus, color: "bg-blue-50 text-blue-700" }, { label: "New Purchase", href: "/purchases/new", icon: PackagePlus, color: "bg-orange-50 text-orange-700" }, { label: "View Reports", href: "/reports", icon: BarChart3, color: "bg-violet-50 text-violet-700" }].map(({ label, href, icon: Icon, color }) => <Link key={href} href={href} className={cn("flex min-h-20 items-center gap-3 rounded-2xl border border-white p-4 font-bold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", color)}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/70"><Icon /></span><span className="text-sm">{label}</span></Link>)}
      </section>}

      <Card className="mt-4"><CardHeader className="flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><ReceiptText className="size-5 text-blue-600" /> {owner ? "Recent Sales" : "My Recent Transactions"}</CardTitle><Link href="/sales" className="text-xs font-bold text-blue-700">View all</Link></CardHeader><CardContent>{recentSales.length === 0 ? <EmptyState icon={ReceiptText} title="No completed sales yet" description="Completed checkouts will appear here." /> : <><div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50 text-xs text-slate-500"><th className="rounded-l-lg px-3 py-2.5 font-semibold">Invoice</th><th className="px-3 py-2.5 font-semibold">Date & time</th><th className="px-3 py-2.5 font-semibold">Items</th><th className="px-3 py-2.5 font-semibold">Payment</th><th className="px-3 py-2.5 font-semibold">Amount</th><th className="rounded-r-lg px-3 py-2.5 font-semibold">Status</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={sale.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-semibold text-blue-700"><Link href={`/sales/${sale.id}`}>{sale.invoice_number}</Link></td><td className="px-3 py-3 text-slate-600">{formatDateTime(sale.completed_at)}</td><td className="px-3 py-3">{sale.item_count}</td><td className="px-3 py-3 capitalize">{sale.payment_method ?? "—"}</td><td className="px-3 py-3 font-bold tabular-nums">{formatCurrency(sale.net_total)}</td><td className="px-3 py-3"><Badge variant={sale.status === "completed" ? "success" : "warning"}>{sale.status.replace("_", " ")}</Badge></td></tr>)}</tbody></table></div><div className="space-y-2 md:hidden">{recentSales.map((sale) => <Link href={`/sales/${sale.id}`} key={sale.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><ReceiptText className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{sale.invoice_number}</span><span className="block text-[11px] text-slate-500">{formatDateTime(sale.completed_at)} · {sale.item_count} items</span></span><span className="text-right"><span className="block text-sm font-extrabold">{formatCurrency(sale.net_total)}</span><span className="text-[10px] capitalize text-slate-500">{sale.payment_method}</span></span></Link>)}</div></>}</CardContent></Card>
    </main>
  );
}

function AlertCard({ title, icon: Icon, items, href, expiry = false }: { title: string; icon: typeof TriangleAlert; items: Alert[]; href: string; expiry?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Icon className={cn("size-5", expiry ? "text-orange-600" : "text-red-600")} /> {title}</CardTitle>
        <Link href={href} className="text-xs font-bold text-blue-700">View all</Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700"><CircleAlert className="size-5" /> No items need attention.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.slice(0, 5).map((item) => (
              <Link href={`/medicines/${item.medicine_id}`} key={item.medicine_id} className="flex min-h-12 items-center gap-3 py-2.5">
                <span className={cn("size-2 shrink-0 rounded-full", expiry ? "bg-orange-500" : "bg-red-500")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.medicine_name} {item.strength}</span>
                  <span className="block text-[11px] text-slate-500">{expiry && item.expiry_date ? `Expires ${formatDate(item.expiry_date)}` : `Reorder at ${item.reorder_level}`}</span>
                </span>
                <span className={cn("text-xs font-bold", expiry ? "text-orange-700" : "text-red-700")}>{expiry ? `${Math.max(0, item.days_until_expiry ?? 0)}d` : `${item.available_quantity} left`}</span>
                <ChevronRight className="size-4 text-slate-300" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
