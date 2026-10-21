// @vitest-environment node
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ARCHIVE_FILENAME, buildWorkbook, DEFAULT_ARCHIVE_LIMITS, inspectWorkbook, type ArchiveInvoice } from "@/lib/invoice-archive/workbook";

const id = (number: number) => "10000000-0000-4000-8000-" + String(number).padStart(12, "0");
const completedAt = "2026-10-01T12:34:56.123456+05:00";
const createdAt = "2026-10-21T02:00:00Z";
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type Snapshot = Record<string, unknown>;
function fixture(number = 1, modify?: (snapshot: Snapshot) => void): ArchiveInvoice {
  const saleId = id(number), itemId = id(number + 100), costId = id(number + 200), returnId = id(number + 300), returnItemId = id(number + 400);
  const snapshot: Snapshot = {
    sale: { id: saleId, invoice_number: "QEI-" + number, completed_at: completedAt, status: "partially_returned", subtotal: "700.00", discount: "20.00", extra_charge_amount: "10.00", extra_charge_description: "Delivery", net_total: "690.00", created_by: id(999) },
    items: [{ id: itemId, sale_id: saleId, medicine_id: id(998), medicine_name: "Paracetamol 500mg", medicine_sku: "PC", quantity: "10.000", unit_label: "tablet", base_units_per_sale_unit: "1", base_quantity: "10.000", unit_price: "70.00", line_total: "700.00", item_discount: "0.00" }],
    payments: [{ id: id(number + 500), sale_id: saleId, kind: "sale", method: "cash", amount: "690.00", tendered_amount: "700.00", change_amount: "10.00" }],
    costs: [{ id: costId, sale_item_id: itemId, batch_id: id(997), quantity: "10.000", unit_cost: "12.3456" }],
    returns: [{ id: returnId, sale_id: saleId, return_number: "RET-" + number, status: "approved", refund_amount: "67.00", reason: "Safe fixture return" }],
    return_items: [{ id: returnItemId, return_id: returnId, sale_item_id: itemId, quantity: "1.000", approved_quantity: "1.000", restockable: true }],
    return_allocations: [{ return_item_id: returnItemId, sale_item_cost_id: costId, base_quantity: "1.000", unit_cost: "12.3456" }],
    stock_movements: [{ id: id(number + 600), medicine_id: id(998), batch_id: id(997), kind: "sale", quantity_delta: "-10.000", quantity_after: "90.000", reference_type: "sales", reference_id: saleId }],
    audit_events: [{ id: String(number), action: "checkout_sale", entity_type: "sales", entity_id: saleId }],
    cashier: { id: id(999), full_name: "Fixture Owner" },
  };
  modify?.(snapshot);
  const payload = JSON.stringify(snapshot);
  return { saleId, completedAt, payload, sourceHash: digest(payload) };
}
const options = (generation = 1, previousSha256: string | null = null) => ({ generation, previousSha256, createdAt });
async function alter(bytes: Uint8Array, change: (workbook: ExcelJS.Workbook) => void) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  change(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("private invoice workbook codec", () => {
  it("creates a real XLSX with every current entity and the exact PostgreSQL source", async () => {
    const invoice = fixture(), result = await buildWorkbook(null, [invoice], options());
    expect(ARCHIVE_FILENAME).toBe("Qeilvra_Invoices.xlsx");
    expect(Array.from(result.bytes.slice(0, 2))).toEqual([80, 75]);
    const inspected = await inspectWorkbook(result.bytes, { sha256: result.sha256, generation: 1, manifest: result.manifest });
    expect(inspected.invoices).toEqual([invoice]);
    expect(inspected.revisions).toEqual([invoice]);
    expect(inspected.invoiceCount).toBe(1); expect(inspected.revisionCount).toBe(1);
    expect(inspected.previousSha256).toBeNull(); expect(inspected.createdAt).toBe(createdAt);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(result.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    for (const name of ["Invoices", "LineItems", "Payments", "Costs", "Returns", "ReturnItems", "ReturnAllocations", "StockMovements", "AuditEvents"]) expect(workbook.getWorksheet(name)?.rowCount, name).toBe(2);
    expect(workbook.getWorksheet("Costs")?.getRow(2).values).toContain("12.3456");
    expect(workbook.getWorksheet("LineItems")?.getRow(2).values).toContain("10.000");
  });

  it("preserves old invoices, deduplicates retries and appends late revisions without doubling current rows", async () => {
    const original = fixture(), second = fixture(2);
    const first = await buildWorkbook(null, [original], options());
    const next = await buildWorkbook(first.bytes, [original, second], options(2, first.sha256));
    const changed = fixture(1, snapshot => { (snapshot.sale as Snapshot).status = "returned"; });
    const third = await buildWorkbook(next.bytes, [changed], options(3, next.sha256));
    const inspected = await inspectWorkbook(third.bytes);
    expect(inspected.invoiceCount).toBe(2); expect(inspected.revisionCount).toBe(3);
    expect(inspected.revisions).toEqual([original, second, changed]);
    expect(inspected.invoices).toEqual([changed, second]);
    expect(inspected.previousSha256).toBe(next.sha256);
    const unchanged = await buildWorkbook(third.bytes, [changed], options(4, third.sha256));
    expect(unchanged.revisionCount).toBe(3); expect(unchanged.invoiceCount).toBe(2);
  });

  it("can select a retained older snapshot without duplicating its raw revision", async () => {
    const original = fixture(), changed = fixture(1, snapshot => { (snapshot.sale as Snapshot).customer_name = "Corrected customer"; });
    const first = await buildWorkbook(null, [original], options());
    const second = await buildWorkbook(first.bytes, [changed], options(2, first.sha256));
    const reverted = await buildWorkbook(second.bytes, [original], options(3, second.sha256));
    const inspected = await inspectWorkbook(reverted.bytes);
    expect(inspected.revisionCount).toBe(2); expect(inspected.invoices).toEqual([original]);
  });

  it("retains decimal source tokens beyond JavaScript precision and trailing zeros", async () => {
    const base = fixture();
    const payload = base.payload.replace('"unit_cost":"12.3456"', '"unit_cost":999999999999999999.123400').replace('"quantity":"10.000"', '"quantity":10.000');
    const invoice = { ...base, payload, sourceHash: digest(payload) };
    const built = await buildWorkbook(null, [invoice], options());
    const inspected = await inspectWorkbook(built.bytes);
    expect(inspected.invoices[0].payload).toBe(payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(built.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet("Costs")?.getRow(2).values).toContain("999999999999999999.123400");
    expect(workbook.getWorksheet("LineItems")?.getRow(2).values).toContain("10.000");
  });

  it("chunks long raw snapshots without splitting Unicode surrogate pairs", async () => {
    const original = fixture(1, snapshot => { snapshot.presentation_note = "CHUNK_BOUNDARY"; });
    const start = original.payload.indexOf("CHUNK_BOUNDARY");
    const payload = original.payload.replace("CHUNK_BOUNDARY", "a".repeat(32_766 - start) + "😀" + "tail");
    const invoice = { ...original, payload, sourceHash: digest(payload) };
    const built = await buildWorkbook(null, [invoice], options());
    expect((await inspectWorkbook(built.bytes)).invoices[0].payload).toBe(invoice.payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(built.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const chunks: string[] = [];
    workbook.getWorksheet("Revisions")!.eachRow((row, number) => { if (number > 1) chunks.push(String(row.getCell(7).value)); });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBe(32_766);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(32_767);
      expect(/[\uD800-\uDBFF]$/.test(chunk)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(chunk)).toBe(false);
    }
  });

  it("stores formula-looking names as literal text", async () => {
    const invoice = fixture(1, snapshot => { (snapshot.items as Snapshot[])[0].medicine_name = '=HYPERLINK("https://invalid.test")'; });
    const built = await buildWorkbook(null, [invoice], options());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(built.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet("LineItems")!.getRow(2).getCell(5).type).toBe(ExcelJS.ValueType.String);
    expect((await inspectWorkbook(built.bytes)).invoices[0]).toEqual(invoice);
  });

  it("supports an empty archive and preserves its schema on an empty retry", async () => {
    const first = await buildWorkbook(null, [], options());
    const next = await buildWorkbook(first.bytes, [], options(2, first.sha256));
    expect((await inspectWorkbook(next.bytes)).invoices).toEqual([]);
    expect(next.revisionCount).toBe(0);
  });

  it("requires the exact predecessor hash and next generation", async () => {
    const first = await buildWorkbook(null, [fixture()], options());
    await expect(buildWorkbook(first.bytes, [], options(2, "0".repeat(64)))).rejects.toThrow("SHA-256 mismatch");
    await expect(buildWorkbook(first.bytes, [], options(2))).rejects.toThrow("previous workbook hash");
    await expect(buildWorkbook(null, [], options(1, first.sha256))).rejects.toThrow("previous workbook hash");
    await expect(buildWorkbook(first.bytes, [], options(4, first.sha256))).rejects.toThrow("generation must follow");
    await expect(inspectWorkbook(first.bytes, { generation: 2 })).rejects.toThrow("generation mismatch");
    await expect(inspectWorkbook(first.bytes, { manifest: [] })).rejects.toThrow("manifest mismatch");
  });

  it("rejects malformed, truncated and oversized ZIP containers before loading", async () => {
    const first = await buildWorkbook(null, [fixture()], options());
    await expect(inspectWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow("ZIP");
    await expect(inspectWorkbook(first.bytes.slice(0, -8))).rejects.toThrow("ZIP");
    await expect(inspectWorkbook(first.bytes, { limits: { maxBytes: first.bytes.length - 1 } })).rejects.toThrow("byte limit");
    await expect(inspectWorkbook(first.bytes, { limits: { maxInflatedBytes: 100 } })).rejects.toThrow("inflated byte limit");
  });

  it.each([
    ["human header", (book: ExcelJS.Workbook) => { book.getWorksheet("Invoices")!.getCell("A1").value = "Unexpected ID"; }, "header mismatch"],
    ["human amount", (book: ExcelJS.Workbook) => { book.getWorksheet("Invoices")!.getCell("G2").value = "1.00"; }, "derived current rows mismatch"],
    ["human formula", (book: ExcelJS.Workbook) => { book.getWorksheet("Invoices")!.getCell("G2").value = { formula: "1+1" }; }, "non-text/formula"],
    ["raw chunk", (book: ExcelJS.Workbook) => { book.getWorksheet("Revisions")!.getCell("G2").value = "{}"; }, "snapshot SHA-256 mismatch"],
    ["chunk count", (book: ExcelJS.Workbook) => { book.getWorksheet("Revisions")!.getCell("F2").value = "2"; }, "truncated"],
    ["generation", (book: ExcelJS.Workbook) => { book.getWorksheet("Metadata")!.getCell("B3").value = "NaN"; }, "invalid generation"],
    ["missing manifest invoice", (book: ExcelJS.Workbook) => { book.getWorksheet("Manifest")!.spliceRows(2, 1); }, "missing from manifest"],
    ["extra sheet", (book: ExcelJS.Workbook) => { book.addWorksheet("Other"); }, "schema mismatch"],
  ] as const)("rejects %s corruption", async (_, change, message) => {
    const built = await buildWorkbook(null, [fixture()], options());
    const corrupt = await alter(built.bytes, change);
    await expect(inspectWorkbook(corrupt)).rejects.toThrow(message);
    await expect(buildWorkbook(corrupt, [], options(2, digest(corrupt)))).rejects.toThrow();
  });

  it.each([
    ["duplicate item", (snapshot: Snapshot) => { (snapshot.items as Snapshot[]).push((snapshot.items as Snapshot[])[0]); }, "duplicate items"],
    ["wrong sale", (snapshot: Snapshot) => { (snapshot.sale as Snapshot).id = id(88); }, "identity mismatch"],
    ["negative quantity", (snapshot: Snapshot) => { (snapshot.items as Snapshot[])[0].quantity = "-1"; }, "invalid sign/quantity"],
    ["zero quantity", (snapshot: Snapshot) => { (snapshot.items as Snapshot[])[0].quantity = "0.000"; }, "invalid sign/quantity"],
    ["bad decimal", (snapshot: Snapshot) => { (snapshot.sale as Snapshot).net_total = "NaN"; }, "invalid decimal"],
    ["missing relation", (snapshot: Snapshot) => { (snapshot.costs as Snapshot[])[0].sale_item_id = id(99); }, "missing costs relation"],
    ["invalid linked UUID", (snapshot: Snapshot) => { (snapshot.items as Snapshot[])[0].medicine_id = "invalid"; }, "must be a UUID"],
    ["invalid base unit quantity", (snapshot: Snapshot) => { (snapshot.items as Snapshot[])[0].base_units_per_sale_unit = "0"; }, "invalid base unit quantity"],
    ["bad audit ID", (snapshot: Snapshot) => { (snapshot.audit_events as Snapshot[])[0].id = "invalid"; }, "invalid audit event ID"],
    ["missing snapshot section", (snapshot: Snapshot) => { delete snapshot.payments; }, "payments must be an array"],
    ["empty invoice", (snapshot: Snapshot) => { snapshot.items = []; }, "at least one item"],
  ] as const)("rejects invalid snapshot: %s", async (_, modify, message) => {
    await expect(buildWorkbook(null, [fixture(1, modify)], options())).rejects.toThrow(message);
  });

  it("rejects duplicate invoice IDs and ambiguous JSON object keys", async () => {
    const invoice = fixture();
    await expect(buildWorkbook(null, [invoice, invoice], options())).rejects.toThrow("duplicate incoming invoice ID");
    const payload = invoice.payload.replace('"sale":{', '"sale":{"id":"duplicate",');
    await expect(buildWorkbook(null, [{ ...invoice, payload, sourceHash: digest(payload) }], options())).rejects.toThrow("duplicate JSON key");
    await expect(buildWorkbook(null, [{ ...invoice, sourceHash: "0".repeat(64) }], options())).rejects.toThrow("snapshot SHA-256 mismatch");
    const another = fixture(2, snapshot => { (snapshot.items as Snapshot[])[0].id = id(101); (snapshot.costs as Snapshot[])[0].sale_item_id = id(101); (snapshot.return_items as Snapshot[])[0].sale_item_id = id(101); });
    await expect(buildWorkbook(null, [invoice, another], options())).rejects.toThrow("duplicate current items ID");
    const invalidWhitespace = "\u00a0" + invoice.payload;
    await expect(buildWorkbook(null, [{ ...invoice, payload: invalidWhitespace, sourceHash: digest(invalidWhitespace) }], options())).rejects.toThrow("invalid JSON value");
  });

  it("fails closed at explicit worksheet, revision, invoice, payload, cell and byte limits", async () => {
    const invoice = fixture(), first = await buildWorkbook(null, [invoice], options());
    await expect(buildWorkbook(null, [invoice], { ...options(), limits: { maxRowsPerSheet: 6 } })).rejects.toThrow("row limit");
    await expect(buildWorkbook(first.bytes, [fixture(2)], { ...options(2, first.sha256), limits: { maxRevisions: 1 } })).rejects.toThrow("revision limit");
    await expect(buildWorkbook(null, [invoice, fixture(2)], { ...options(), limits: { maxInvoices: 1 } })).rejects.toThrow("invoice limit");
    await expect(buildWorkbook(null, [invoice], { ...options(), limits: { maxPayloadBytes: 50 } })).rejects.toThrow("payload size");
    await expect(buildWorkbook(null, [invoice], { ...options(), limits: { maxCellCodeUnits: 63 } })).rejects.toThrow("cell text limit");
    await expect(buildWorkbook(null, [invoice], { ...options(), limits: { maxBytes: 200 } })).rejects.toThrow("byte limit");
    await expect(buildWorkbook(null, [invoice], { ...options(), limits: { maxRowsPerSheet: 1_048_577 } })).rejects.toThrow("Excel worksheet/cell limit");
    await expect(buildWorkbook(null, [invoice], { ...options(), limits: { maxWorkMs: 0 } })).rejects.toThrow("invalid maxWorkMs");
    expect(DEFAULT_ARCHIVE_LIMITS.maxBytes).toBe(32 * 1024 * 1024);
  });

  it("does not emit an artifact after exhausting its runtime budget", async () => {
    await expect(buildWorkbook(null, [fixture()], { ...options(), limits: { maxWorkMs: 1 } })).rejects.toThrow("work time limit exceeded");
  });
});
