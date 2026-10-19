import { loadDispositionHistory } from "@/lib/stock-disposition-data";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateISO } from "@/lib/utils";
import { searchPattern, summarizeSupplier, supplierAlerts, type InventoryBatch, type InventoryMedicine, type PurchaseSummary, type Supplier, type SupplierDelivery, type SupplierInvoice } from "@/lib/supplier-profile";

type Client = Awaited<ReturnType<typeof createClient>>;
const PAGE_SIZE = 12;
const itemFields = "id,medicine_id,batch_number,expiry_date,quantity,unit_cost,line_total,received_unit,received_quantity,base_units_per_received_unit,medicines!inner(name,strength,sku,base_unit)";
const invoiceFields = "id,purchase_number,supplier_invoice_number,invoice_date,posted_at,status,total";

// Range through lean rows so Supabase's response cap never silently truncates totals.
async function allRows<T>(fetchPage: (start: number, end: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 200) {
    const { data, error } = await fetchPage(start, start + 199);
    if (error) throw new Error("Supplier records could not be loaded. Please try again.");
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 200) return rows;
  }
}

async function loadAlerts(client: Client, lastPurchases: Record<string, string>) {
  const ids = Object.keys(lastPurchases);
  if (!ids.length) return [];
  const { data: settings, error } = await client.from("pharmacy_settings").select("expiry_alert_days").eq("id", true).single();
  if (error || !settings) throw new Error("Expiry settings could not be loaded. Please try again.");
  const medicines: InventoryMedicine[] = [];
  const batches: InventoryBatch[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    const [medicineRows, batchRows] = await Promise.all([
      allRows<InventoryMedicine>((from, to) => client.from("medicines").select("id,name,strength,base_unit,reorder_level,is_active").in("id", chunk).order("id").range(from, to)),
      // Deliberately no supplier filter: availability belongs to the whole pharmacy.
      allRows<InventoryBatch>((from, to) => client.from("medicine_batches").select("id,medicine_id,quantity_on_hand,expiry_date,is_quarantined").in("medicine_id", chunk).gt("quantity_on_hand", 0).eq("is_quarantined", false).gte("expiry_date", localDateISO()).order("id").range(from, to)),
    ]);
    medicines.push(...medicineRows); batches.push(...batchRows);
  }
  return supplierAlerts(medicines, batches, lastPurchases, Number(settings.expiry_alert_days));
}

export type ProfileOptions = { tab: string; query: string; page: number; status: string };
export async function loadSupplierProfile(id: string, options: ProfileOptions) {
  // Keep this guard inside the loader: no financial query can run before authorization.
  await requireOwner();
  const client = await createClient();
  const { data, error } = await client.from("suppliers").select("id,name,contact_person,phone,email,address,tax_number,is_active,created_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Supplier details could not be loaded. Please try again.");
  if (!data) return null;
  const summaryRows = await allRows<PurchaseSummary>((from, to) => client.from("purchases")
    .select("id,supplier_id,invoice_date,status,total,purchase_items(medicine_id)")
    .eq("supplier_id", id).order("id").range(from, to));
  const summary = summarizeSupplier(id, summaryRows);
  const limit = options.tab === "overview" ? 3 : PAGE_SIZE;
  const offset = options.tab === "overview" ? 0 : (options.page - 1) * limit;
  const [alerts, invoices, deliveries, stockHistory] = await Promise.all([
    ["overview", "alerts"].includes(options.tab) ? loadAlerts(client, summary.lastPurchases) : Promise.resolve([]),
    (async () => {
      if (!["overview", "history"].includes(options.tab)) return { rows: [] as SupplierInvoice[], count: 0 };
      let request = client.from("purchases").select(`${invoiceFields},purchase_items(${itemFields})`, { count: "exact" }).eq("supplier_id", id);
      if (options.tab === "overview") request = request.eq("status", "posted");
      else {
        if (options.status !== "all") request = request.eq("status", options.status);
        if (options.query) request = request.or(`purchase_number.ilike.${searchPattern(options.query)},supplier_invoice_number.ilike.${searchPattern(options.query)}`);
      }
      const { data, error, count } = await request.order("invoice_date", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw new Error("Purchase history could not be loaded. Please try again.");
      return { rows: (data ?? []) as unknown as SupplierInvoice[], count: count ?? 0 };
    })(),
    (async () => {
      if (!["overview", "medicines"].includes(options.tab)) return { rows: [] as SupplierDelivery[], count: 0 };
      let request = client.from("purchase_items").select(`${itemFields},purchases!inner(${invoiceFields})`, { count: "exact" }).eq("purchases.supplier_id", id).eq("purchases.status", "posted");
      if (options.tab === "medicines" && options.query) request = request.or(`name.ilike.${searchPattern(options.query)},strength.ilike.${searchPattern(options.query)},sku.ilike.${searchPattern(options.query)}`, { referencedTable: "medicines" });
      const { data, error, count } = await request.order("purchases(invoice_date)", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw new Error("Medicines received could not be loaded. Please try again.");
      return { rows: (data ?? []) as unknown as SupplierDelivery[], count: count ?? 0 };
    })(),
    loadDispositionHistory({ supplierId: id }),
  ]);
  return { supplier: data as Supplier, summary, alerts, invoices, deliveries, stockHistory, pageSize: PAGE_SIZE };
}
