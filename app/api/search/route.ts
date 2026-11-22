import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentStaff } from "@/lib/auth";
import type { GlobalSearchResult } from "@/lib/global-search";
import { textSearchFilter } from "@/lib/live-search";
import { safeAppPath } from "@/lib/navigation";
import { canManageOperations } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const NO_STORE = { "Cache-Control": "private, no-store" };

type SearchRequest<Row> = PromiseLike<{ data: Row[] | null; error: unknown }> & {
  or: (filters: string) => SearchRequest<Row>;
  limit: (count: number) => SearchRequest<Row>;
};

async function searchGroup<Row>(
  request: SearchRequest<Row>,
  query: string,
  columns: string[],
  limit: number,
  toResult: (record: Row) => GlobalSearchResult,
) {
  if (query) request = request.or(textSearchFilter(query, ...columns));
  const { data, error } = await request.limit(limit + 1);
  if (error) throw new Error("Search data unavailable");
  const rows = data ?? [];
  return { rows: rows.slice(0, limit).map(toResult), complete: rows.length <= limit };
}

function filterLink(path: string, params: Record<string, string>) {
  return path + "?" + new URLSearchParams(params);
}

export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const parsed = z.string().trim().max(100).safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) return NextResponse.json({ error: "Invalid search" }, { status: 400, headers: NO_STORE });
  const query = parsed.data;
  const client = await createClient();

  try {
    // These are session-scoped queries. Page-level role checks still apply to shared tables.
    const groups = await Promise.all([
      searchGroup(
        client.from("medicines").select("id,name,generic_name,strength,sku,barcode,selling_price")
          .eq("is_active", true).order("name").order("id"),
        query, ["name", "generic_name", "strength", "sku", "barcode"], 6,
        (row) => ({
          id: row.id, type: "medicine", title: row.name, href: "/medicines/" + row.id,
          subtitle: [row.generic_name, row.strength, row.sku].filter(Boolean).join(" · "),
          fields: [row.name, row.generic_name, row.strength, row.sku, row.barcode],
          meta: formatCurrency(row.selling_price),
        }),
      ),
      searchGroup(
        client.from("sales").select("id,invoice_number,net_total,completed_at")
          .order("completed_at", { ascending: false }).order("id", { ascending: false }),
        query, ["invoice_number"], 5,
        (row) => ({
          id: row.id, type: "invoice", title: row.invoice_number, href: "/sales/" + row.id,
          fields: [row.invoice_number], subtitle: formatDateTime(row.completed_at), meta: formatCurrency(row.net_total),
        }),
      ),
      searchGroup(
        client.from("sale_returns").select("id,return_number,reason")
          .order("requested_at", { ascending: false }).order("id", { ascending: false }),
        query, ["return_number", "reason"], 4,
        (row) => ({
          id: row.id, type: "return", title: row.return_number,
          href: filterLink("/returns", { q: row.return_number }),
          fields: [row.return_number, row.reason],
        }),
      ),
      searchGroup(
        client.from("notifications").select("id,title,message,action_url")
          .order("created_at", { ascending: false }).order("id", { ascending: false }),
        query, ["title", "message"], 3,
        (row) => ({
          id: row.id, type: "notification", title: row.title,
          href: safeAppPath(row.action_url, filterLink("/notifications", { q: row.title.slice(0, 100) })),
          fields: [row.title, row.message],
        }),
      ),
      ...(canManageOperations(staff.role) ? [
        searchGroup(
          client.from("purchases").select("id,purchase_number,supplier_invoice_number")
            .order("created_at", { ascending: false }).order("id", { ascending: false }),
          query, ["purchase_number", "supplier_invoice_number"], 4,
          (row) => ({
            id: row.id, type: "purchase", title: row.purchase_number, href: "/purchases/" + row.id,
            fields: [row.purchase_number, row.supplier_invoice_number], subtitle: row.supplier_invoice_number,
          }),
        ),
        searchGroup(
          client.from("suppliers").select("id,name,contact_person").order("name").order("id"),
          query, ["name", "contact_person"], 4,
          (row) => ({
            id: row.id, type: "supplier", title: row.name, href: "/suppliers/" + row.id,
            fields: [row.name, row.contact_person], subtitle: row.contact_person,
          }),
        ),
        searchGroup(
          client.from("medicine_batches").select("id,medicine_id,batch_number")
            .order("expiry_date").order("id"),
          query, ["batch_number"], 4,
          (row) => ({
            id: row.id, type: "batch", title: row.batch_number,
            href: filterLink("/stock", { q: row.batch_number, medicine: row.medicine_id }),
            fields: [row.batch_number],
          }),
        ),
        searchGroup(
          client.from("expenses").select("id,description,payee,reference,expense_date")
            .order("expense_date", { ascending: false }).order("id", { ascending: false }),
          query, ["description", "payee", "reference"], 4,
          (row) => ({
            id: row.id, type: "expense", title: row.description, subtitle: row.payee,
            href: filterLink("/expenses", { from: row.expense_date, to: row.expense_date, q: row.description.slice(0, 100) }),
            fields: [row.description, row.payee, row.reference],
          }),
        ),
      ] : []),
      ...(staff.role === "owner" ? [
        searchGroup(
          client.from("profiles").select("id,full_name,phone,user_roles!inner(role)")
            .in("user_roles.role", ["salesperson", "manager"]).order("full_name").order("id"),
          query, ["full_name", "phone"], 4,
          (row) => ({
            id: row.id, type: "staff", title: row.full_name,
            href: filterLink("/users", { q: row.full_name.slice(0, 100) }),
            fields: [row.full_name, row.phone],
          }),
        ),
        searchGroup(
          client.from("audit_logs").select("id,action,entity_type").order("created_at", { ascending: false }).order("id", { ascending: false }),
          query, ["action", "entity_type"], 3,
          (row) => ({
            id: row.id, type: "audit", title: row.action.replaceAll("_", " "),
            href: filterLink("/audit", { q: row.action }), fields: [row.action, row.entity_type], subtitle: row.entity_type,
          }),
        ),
      ] : []),
    ]);
    return NextResponse.json(groups.flatMap(({ rows }) => rows), { headers: {
      ...NO_STORE,
      "X-Search-Complete": String(groups.every(({ complete }) => complete)),
    } });
  } catch {
    return NextResponse.json({ error: "Search could not load. Please try again." }, { status: 503, headers: NO_STORE });
  }
}
