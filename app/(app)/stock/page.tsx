import { z } from "zod";
import { DispositionHistory } from "@/components/stock/disposition-history";
import { StockBatchList, type StockBatch } from "@/components/stock/stock-batch-list";
import { requireOperationsManager } from "@/lib/auth";
import { pageNumber } from "@/lib/pagination";
import { loadDispositionHistory } from "@/lib/stock-disposition-data";
import { createClient } from "@/lib/supabase/server";
import { localDateISO } from "@/lib/utils";

const FETCH_SIZE = 1000;

async function loadStockBatches(client: Awaited<ReturnType<typeof createClient>>, medicineId?: string, supplierId?: string) {
  const batches: StockBatch[] = [];
  let afterId: string | undefined;

  // Read past Supabase's row limit using the batch ID as a stable cursor.
  for (;;) {
    let request = client.from("medicine_batches")
      .select("id,supplier_id,batch_number,expiry_date,quantity_on_hand,purchase_cost::text,is_quarantined,medicines!inner(id,name,generic_name,strength,sku,base_unit),suppliers(name),purchase_items(purchases(supplier_id,suppliers(name)))")
      .order("id")
      .limit(FETCH_SIZE);
    if (medicineId) request = request.eq("medicine_id", medicineId);
    if (supplierId) request = request.eq("supplier_id", supplierId);
    if (afterId) request = request.gt("id", afterId);

    const { data, error } = await request;
    if (error) throw new Error("Stock batches could not be loaded. Please try again.");
    const rows = (data ?? []) as unknown as StockBatch[];
    batches.push(...rows);
    if (rows.length < FETCH_SIZE) break;
    afterId = rows[rows.length - 1].id;
  }

  return batches.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
}

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string; medicine?: string; supplier?: string; purchase?: string; actionPage?: string }> }) {
  const staff = await requireOperationsManager();
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? "").slice(0, 100);
  const page = pageNumber(params.page);
  const supplierFilter = z.uuid().safeParse(params.supplier);
  const purchaseFilter = z.uuid().safeParse(params.purchase);
  const supplierId = supplierFilter.success ? supplierFilter.data : undefined;
  const purchaseId = purchaseFilter.success ? purchaseFilter.data : undefined;
  const actionPage = pageNumber(params.actionPage);
  const supabase = await createClient();
  const [batches, supplierResult, history] = await Promise.all([
    loadStockBatches(supabase, params.medicine, supplierId),
    supabase.from("suppliers").select("id,name").order("name"),
    loadDispositionHistory({ stockPage: true, page: actionPage, supplierId, purchaseId, medicineId: z.uuid().safeParse(params.medicine).success ? params.medicine : undefined }),
  ]);
  if (supplierResult.error) throw new Error("Suppliers could not be loaded. Please retry.");

  return (
    <main className="mx-auto max-w-[1450px] p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-sm font-semibold text-blue-700">Batch-level inventory</p>
        <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Stock batches & corrections</h1>
        <p className="mt-1 text-sm text-slate-500">Check each received batch, its expiry and supplier. Choose a medicine and batch, then Discard Stock or Return to Supplier. Expired stock is blocked from POS before disposal. Correct Stock is for physical count corrections.</p>
      </div>
      <StockBatchList
        key={JSON.stringify([query, page, params.medicine, supplierId, purchaseId, actionPage])}
        batches={batches}
        suppliers={supplierResult.data ?? []}
        staffId={staff.id}
        today={localDateISO()}
        initialQuery={query}
        initialPage={page}
        filters={{ medicine: params.medicine, supplier: supplierId, purchase: purchaseId, actionPage: params.actionPage }}
      />
      <DispositionHistory history={history} />
    </main>
  );
}
