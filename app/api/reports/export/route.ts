import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { csvRow } from "@/lib/csv";
import type { FinancialSnapshot } from "@/lib/financial-analytics";

const schema = z.object({ type: z.enum(["sales", "purchases", "expenses", "inventory", "returns", "refunds", "financials"]), from: z.iso.date(), to: z.iso.date() }).refine(value => value.from <= value.to);
type Row = Record<string, unknown>;
const nested = (row: Row, key: string, field: string) => (row[key] as Row | null)?.[field];
const exportConfig = {
  sales: { table: "sales", fields: "id,invoice_number,completed_at,subtotal,discount,extra_charge_amount,extra_charge_description,net_total,status,profiles!sales_created_by_fkey(full_name)", date: "completed_at", timestamp: true, headers: ["Invoice", "Completed At", "Subtotal", "Discount", "Extra Charges", "Charge Description", "Total Charged", "Status", "Salesperson"], cells: (r: Row) => [r.invoice_number,r.completed_at,r.subtotal,r.discount,r.extra_charge_amount,r.extra_charge_description,r.net_total,r.status,nested(r,"profiles","full_name")] },
  purchases: { table: "purchases", fields: "id,purchase_number,invoice_date,status,subtotal,discount,total,suppliers(name)", date: "invoice_date", timestamp: false, headers: ["Purchase", "Invoice Date", "Supplier", "Status", "Subtotal", "Discount", "Total"], cells: (r: Row) => [r.purchase_number,r.invoice_date,nested(r,"suppliers","name"),r.status,r.subtotal,r.discount,r.total] },
  expenses: { table: "expenses", fields: "id,expense_date,description,payee,amount,payment_method,expense_categories(name)", date: "expense_date", timestamp: false, headers: ["Date", "Category", "Description", "Payee", "Amount", "Payment Method"], cells: (r: Row) => [r.expense_date,nested(r,"expense_categories","name"),r.description,r.payee,r.amount,r.payment_method] },
  returns: { table: "sale_returns", fields: "id,return_number,requested_at,status,reason,refund_amount,sales(invoice_number)", date: "requested_at", timestamp: true, headers: ["Return", "Sale Invoice", "Requested At", "Status", "Reason", "Refund Amount"], cells: (r: Row) => [r.return_number,nested(r,"sales","invoice_number"),r.requested_at,r.status,r.reason,r.refund_amount] },
  refunds: { table: "sale_returns", fields: "id,return_number,reviewed_at,status,reason,refund_amount,sales(invoice_number)", date: "reviewed_at", timestamp: true, headers: ["Return", "Sale Invoice", "Completed At", "Status", "Reason", "Refund Amount"], cells: (r: Row) => [r.return_number,nested(r,"sales","invoice_number"),r.reviewed_at,r.status,r.reason,r.refund_amount] },
  inventory: { table: "medicine_batches", fields: "id,batch_number,expiry_date,quantity_on_hand,purchase_cost,is_quarantined,medicines(name,sku),suppliers(name)", date: "expiry_date", timestamp: false, headers: ["Medicine", "SKU", "Batch", "Expiry", "Quantity", "Unit Cost", "Supplier", "Quarantined"], cells: (r: Row) => [nested(r,"medicines","name"),nested(r,"medicines","sku"),r.batch_number,r.expiry_date,r.quantity_on_hand,r.purchase_cost,nested(r,"suppliers","name"),r.is_quarantined] },
};

export async function GET(request: Request) {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report request." }, { status: 400 });
  const { type, from, to } = parsed.data;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: role, error: roleError } = await supabase.rpc("current_role");
  if (roleError || role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (type === "financials") {
    const { data, error } = await supabase.rpc("owner_financial_analytics", { p_from: from, p_to: to, p_granularity: "day" });
    if (error || !data?.metrics) return NextResponse.json({ error: "Financial export could not load. Please retry." }, { status: 503 });
    const snapshot = data as FinancialSnapshot;
    const fields = ["sales_count", "gross_sales", "discounts", "refunds", "medicine_revenue", "extra_charge_revenue", "revenue", "cogs", "gross_profit", "expenses", "net_operating_profit", "stock_written_off", "supplier_returns_value", "supplier_recoveries", "supplier_replacements_value", "net_inventory_loss"] as const;
    const headings = ["Date (Asia/Karachi)", "Total Sales", "Gross Sales", "Discounts Given", "Sales Refunds", "Net Medicine Revenue", "Extra Charges", "Total Revenue", "Cost of Goods Sold", "Gross Profit", "Operating Expenses", "Net Operating Profit", "Expired/Damaged Stock Written Off", "Stock Value Returned to Suppliers", "Confirmed Supplier Refunds/Credits", "Replacement Stock Received", "Net Inventory Loss"];
    const csv = "\uFEFF" + csvRow(headings) + snapshot.daily.map(day => csvRow([day.sale_date, ...fields.map(field => day[field])])).join("") + csvRow(["TOTAL", ...fields.map(field => snapshot.metrics[field])]);
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="qeilvra-financials-${from}-to-${to}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const config = exportConfig[type];
  async function page(after?: { date: string; id: string }) {
    let query = supabase.from(config.table).select(config.fields, after ? undefined : { count: "exact" });
    if (type === "refunds") query = query.eq("status", "approved");
    if (type !== "inventory") query = query.gte(config.date, from + (config.timestamp ? "T00:00:00+05:00" : "")).lte(config.date, to + (config.timestamp ? "T23:59:59.999999+05:00" : ""));
    // Seek from the last saved date/id. Offset paging can repeat invoices when
    // another cashier/Owner inserts a backdated record during a long export.
    if (after) query = query.or(`${config.date}.gt.${after.date},and(${config.date}.eq.${after.date},id.gt.${after.id})`);
    const result = await query.order(config.date).order("id").range(0, 499);
    if (result.error) throw new Error("Export could not load. Please retry.");
    return { rows: (result.data ?? []) as unknown as Row[], count: result.count };
  }
  let first;
  try { first = await page(); }
  catch { return NextResponse.json({ error: "Export could not load. Please retry." }, { status: 503 }); }
  if (first.count == null) return NextResponse.json({ error: "Export completeness could not be verified. Please retry." }, { status: 503 });
  const total = first.count;
  let batch = first.rows, sent = 0, heading = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (heading) { controller.enqueue(encoder.encode("\uFEFF" + csvRow(config.headers))); heading = false; }
        if (!batch.length && sent < total) throw new Error("Export interrupted. Retry the download.");
        if (batch.length) { controller.enqueue(encoder.encode(batch.map(row => csvRow(config.cells(row))).join(""))); sent += batch.length; }
        if (sent >= total) { controller.close(); return; }
        const last = batch.at(-1);
        if (!last || typeof last[config.date] !== "string" || typeof last.id !== "string") throw new Error("Export cursor unavailable.");
        batch = (await page({ date: last[config.date] as string, id: last.id })).rows;
      } catch { controller.error(new Error("Export interrupted. Retry the download.")); }
    },
  });
  return new NextResponse(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="qeilvra-${type}-${from}-to-${to}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
