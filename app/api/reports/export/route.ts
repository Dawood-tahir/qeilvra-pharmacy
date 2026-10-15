import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ type: z.enum(["sales", "purchases", "expenses", "inventory", "returns"]), from: z.iso.date(), to: z.iso.date() });

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function toCsv(headers: string[], rows: unknown[][]) { return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n"); }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report request." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: role } = await supabase.rpc("current_role");
  if (role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let csv = "";
  if (parsed.data.type === "sales") {
    const fromTime = `${parsed.data.from}T00:00:00+05:00`; const toTime = `${parsed.data.to}T23:59:59.999+05:00`;
    const { data } = await supabase.from("sales").select("invoice_number,completed_at,subtotal,discount,net_total,status,profiles!sales_created_by_fkey(full_name)").gte("completed_at", fromTime).lte("completed_at", toTime).order("completed_at");
    csv = toCsv(["Invoice", "Completed At", "Subtotal", "Discount", "Net Revenue", "Status", "Salesperson"], (data ?? []).map((r) => [r.invoice_number, r.completed_at, r.subtotal, r.discount, r.net_total, r.status, (r.profiles as unknown as { full_name?: string })?.full_name]));
  } else if (parsed.data.type === "purchases") {
    const { data } = await supabase.from("purchases").select("purchase_number,invoice_date,status,subtotal,discount,total,suppliers(name)").gte("invoice_date", parsed.data.from).lte("invoice_date", parsed.data.to).order("invoice_date");
    csv = toCsv(["Purchase", "Invoice Date", "Supplier", "Status", "Subtotal", "Discount", "Total"], (data ?? []).map((r) => [r.purchase_number, r.invoice_date, (r.suppliers as unknown as { name?: string })?.name, r.status, r.subtotal, r.discount, r.total]));
  } else if (parsed.data.type === "expenses") {
    const { data } = await supabase.from("expenses").select("expense_date,description,payee,amount,payment_method,expense_categories(name)").gte("expense_date", parsed.data.from).lte("expense_date", parsed.data.to).order("expense_date");
    csv = toCsv(["Date", "Category", "Description", "Payee", "Amount", "Payment Method"], (data ?? []).map((r) => [r.expense_date, (r.expense_categories as unknown as { name?: string })?.name, r.description, r.payee, r.amount, r.payment_method]));
  } else if (parsed.data.type === "returns") {
    const { data } = await supabase.from("sale_returns").select("return_number,requested_at,status,reason,refund_amount,sales(invoice_number)").gte("requested_at", `${parsed.data.from}T00:00:00+05:00`).lte("requested_at", `${parsed.data.to}T23:59:59.999+05:00`).order("requested_at");
    csv = toCsv(["Return", "Sale Invoice", "Requested At", "Status", "Reason", "Refund Amount"], (data ?? []).map((r) => [r.return_number, (r.sales as unknown as { invoice_number?: string })?.invoice_number, r.requested_at, r.status, r.reason, r.refund_amount]));
  } else {
    const { data } = await supabase.from("medicine_batches").select("batch_number,expiry_date,quantity_on_hand,purchase_cost,is_quarantined,medicines(name,sku),suppliers(name)").order("expiry_date");
    csv = toCsv(["Medicine", "SKU", "Batch", "Expiry", "Quantity", "Unit Cost", "Supplier", "Quarantined"], (data ?? []).map((r) => [ (r.medicines as unknown as { name?: string })?.name, (r.medicines as unknown as { sku?: string })?.sku, r.batch_number, r.expiry_date, r.quantity_on_hand, r.purchase_cost, (r.suppliers as unknown as { name?: string })?.name, r.is_quarantined ]));
  }
  return new NextResponse(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="qeilvra-${parsed.data.type}-${parsed.data.from}-to-${parsed.data.to}.csv"`, "Cache-Control": "private, no-store" } });
}
