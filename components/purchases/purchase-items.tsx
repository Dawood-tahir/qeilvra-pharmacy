import { pluralUnit } from "@/lib/medicine-units";
import { formatCurrency, formatDate } from "@/lib/utils";

// Both layouts use the saved receipt quantities and cost snapshots.
export function PurchaseItems({ items }: { items: Record<string, unknown>[] }) {
  const rows = items.map((item) => {
    const med = item.medicines as { name: string; strength?: string; sku: string; base_unit: string };
    return {
      id: String(item.id), name: med.name + (med.strength ? " " + med.strength : ""), sku: med.sku,
      batch: String(item.batch_number), expiry: formatDate(String(item.expiry_date)),
      quantity: pluralUnit(String(item.received_unit ?? med.base_unit), Number(item.received_quantity ?? item.quantity)),
      baseQuantity: item.received_unit ? pluralUnit(med.base_unit, Number(item.quantity)) + " total" : null,
      cost: formatCurrency(Number(item.unit_cost) * Number(item.base_units_per_received_unit ?? 1)) + " / " + String(item.received_unit ?? med.base_unit),
      total: formatCurrency(Number(item.line_total)),
    };
  });
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-slate-500"><tr>{["Medicine", "Batch", "Expiry", "Purchased quantity", "Cost per unit", "Total cost"].map((label) => <th key={label} className="px-3 py-3 first:pl-0 last:text-right">{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="py-3"><strong>{row.name}</strong><p className="text-xs text-slate-500">{row.sku}</p></td><td className="px-3 py-3">{row.batch}</td><td className="px-3 py-3">{row.expiry}</td><td className="px-3 py-3">{row.quantity}<span className="block text-xs text-slate-500">{row.baseQuantity}</span></td><td className="px-3 py-3">{row.cost}</td><td className="py-3 text-right font-bold">{row.total}</td></tr>)}</tbody></table></div>
    <div className="space-y-3 md:hidden">{rows.map((row) => <article key={row.id} className="rounded-xl border border-slate-200 p-3"><h3 className="break-words font-bold">{row.name}</h3><p className="text-xs text-slate-500">{row.sku}</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Purchased quantity</dt><dd className="font-semibold">{row.quantity}<span className="block text-xs font-normal text-slate-500">{row.baseQuantity}</span></dd></div><div><dt className="text-xs text-slate-500">Cost per unit</dt><dd>{row.cost}</dd></div><div className="min-w-0"><dt className="text-xs text-slate-500">Batch</dt><dd className="break-words">{row.batch}</dd></div><div><dt className="text-xs text-slate-500">Expiry</dt><dd>{row.expiry}</dd></div></dl><p className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3 text-sm"><span>Total cost</span><strong>{row.total}</strong></p></article>)}</div>
  </>;
}
