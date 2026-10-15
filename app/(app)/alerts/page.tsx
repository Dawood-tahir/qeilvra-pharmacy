import Link from "next/link";
import { AlertTriangle, CalendarClock, ChevronRight, PackageX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate } from "@/lib/utils";

type AlertItem = {
  medicine_id: string;
  medicine_name: string;
  strength?: string;
  sku: string;
  available_quantity: number;
  reorder_level: number;
  expiry_date?: string;
  alert_kind: string;
  days_until_expiry?: number;
};

const tabs = [
  { id: "low_stock", label: "Low Stock" },
  { id: "out_of_stock", label: "Out of Stock" },
  { id: "expiring", label: "Expiring" },
];

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireStaff();
  const params = await searchParams;
  const selected = ["low_stock", "out_of_stock", "expiring"].includes(params.filter ?? "")
    ? params.filter!
    : "low_stock";
  const supabase = await createClient();
  const { data } = await supabase.rpc("inventory_alerts", { p_kind: selected, p_limit: 100 });
  const items = (data ?? []) as AlertItem[];

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <p className="text-sm font-semibold text-blue-700">Inventory attention</p>
      <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Stock alerts</h1>
      <p className="mt-1 text-sm text-slate-500">Actionable availability and expiry warnings. Purchase costs are not shown.</p>
      <div className="scrollbar-thin mt-5 flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <Link key={tab.id} href={`/alerts?filter=${tab.id}`} className={cn("shrink-0 rounded-xl border px-4 py-2.5 text-sm font-semibold", selected === tab.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600")}>{tab.label}</Link>
        ))}
      </div>
      <Card className="mt-4">
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState icon={PackageX} title="Nothing needs attention" description="There are no medicines in this alert category." />
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <Link key={item.medicine_id} href={`/medicines/${item.medicine_id}`} className="flex min-h-16 items-center gap-3 p-4 hover:bg-slate-50">
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", selected === "expiring" ? "bg-orange-50 text-orange-700" : "bg-red-50 text-red-700")}>
                    {selected === "expiring" ? <CalendarClock className="size-5" /> : <AlertTriangle className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{item.medicine_name} {item.strength}</span>
                    <span className="block text-xs text-slate-500">SKU {item.sku}{selected === "expiring" && item.expiry_date ? ` · expires ${formatDate(item.expiry_date)}` : ` · reorder at ${item.reorder_level}`}</span>
                  </span>
                  <span className={cn("text-sm font-extrabold", selected === "expiring" ? "text-orange-700" : "text-red-700")}>
                    {selected === "expiring" ? `${Math.max(0, item.days_until_expiry ?? 0)} days` : `${item.available_quantity} left`}
                  </span>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
