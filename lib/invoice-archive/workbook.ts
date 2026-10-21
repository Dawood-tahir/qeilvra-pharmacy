import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import type { ArchiveInvoice, ArchiveLimits, ArchiveManifestEntry, ArchiveWorkbookBuild, ArchiveWorkbookInspection, BuildWorkbookOptions, InspectWorkbookExpected } from "./types";

export type { ArchiveInvoice, ArchiveLimits, ArchiveManifestEntry, ArchiveWorkbookBuild, ArchiveWorkbookInspection, BuildWorkbookOptions, InspectWorkbookExpected } from "./types";

export const ARCHIVE_FILENAME = "Qeilvra_Invoices.xlsx";
export const ARCHIVE_SCHEMA_VERSION = "1";
export const DEFAULT_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  maxBytes: 32 * 1024 * 1024,
  maxInflatedBytes: 256 * 1024 * 1024,
  maxRowsPerSheet: 1_000_000,
  maxCellCodeUnits: 32_767,
  maxRevisions: 100_000,
  maxInvoices: 100_000,
  maxPayloadBytes: 8 * 1024 * 1024,
  maxWorkMs: 120_000,
});

type Value = string | boolean | null | Value[] | { [key: string]: Value };
type RecordValue = { [key: string]: Value };
type ParsedInvoice = { invoice: ArchiveInvoice; snapshot: RecordValue };
type Row = string[];
type Projection = { name: string; headers: string[]; rows: Row[] };
type Budget = { limits: ArchiveLimits; check: () => void; deadline: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const ENTITIES = ["items", "payments", "costs", "returns", "return_items", "return_allocations", "stock_movements", "audit_events"] as const;
const REVISION_HEADERS = ["Revision", "Invoice ID", "Completed At", "Source SHA-256", "Chunk Index", "Chunk Count", "Payload Chunk"];
const META_KEYS = ["Schema Version", "Generation", "Previous SHA-256", "Created At", "Invoice Count", "Revision Count"];
const MANIFEST_HEADERS = ["Invoice ID", "Source SHA-256"];

function fail(message: string): never { throw new Error("Invoice archive: " + message); }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function budget(overrides?: Partial<ArchiveLimits>): Budget {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1) fail("invalid " + key + " limit");
  if (limits.maxRowsPerSheet > 1_048_576 || limits.maxCellCodeUnits > 32_767) fail("Excel worksheet/cell limit exceeded");
  const deadline = Date.now() + limits.maxWorkMs;
  return { limits, deadline, check: () => { if (Date.now() > deadline) fail("work time limit exceeded"); } };
}
async function withinBudget<T>(promise: Promise<T>, guard: Budget): Promise<T> {
  guard.check();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Invoice archive: work time limit exceeded")), Math.max(1, guard.deadline - Date.now())); })]);
  } finally { clearTimeout(timer); guard.check(); }
}
function object(value: Value | undefined, label: string): RecordValue {
  if (!value || Array.isArray(value) || typeof value !== "object") fail(label + " must be an object");
  return value;
}
function string(value: Value | undefined, label: string): string {
  if (typeof value !== "string") fail(label + " must be text");
  return value;
}
function uuid(value: Value | undefined, label: string): string {
  const result = string(value, label);
  if (!UUID.test(result)) fail(label + " must be a UUID");
  return result;
}
function timestamp(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("invalid " + label);
  if (new Date(value.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !== value.slice(0, 10)) fail("invalid calendar date in " + label);
}

/** JSON numbers remain their exact source tokens; financial arithmetic is never performed here. */
function losslessJson(source: string, guard: Budget): RecordValue {
  let index = 0;
  const white = () => { while (/[ \t\r\n]/.test(source[index] ?? "") && index < source.length) index++; };
  function value(depth = 0): Value {
    if (depth > 64) fail("snapshot nesting limit exceeded");
    guard.check(); white();
    const character = source[index];
    if (character === '"') {
      const start = index++;
      while (index < source.length) {
        if (source[index] === "\\") { index += 2; continue; }
        if (source[index++] === '"') return JSON.parse(source.slice(start, index)) as string;
      }
      fail("unterminated JSON text");
    }
    if (character === "{" || character === "[") {
      const array = character === "[", close = array ? "]" : "}";
      index++; white();
      const result: Value[] | RecordValue = array ? [] : Object.create(null);
      if (source[index] === close) { index++; return result; }
      while (index < source.length) {
        if (array) (result as Value[]).push(value(depth + 1));
        else {
          white(); if (source[index] !== '"') fail("invalid JSON object key");
          const key = string(value(depth + 1), "JSON key"); white();
          if (source[index++] !== ":" || Object.hasOwn(result, key)) fail("invalid or duplicate JSON key");
          (result as RecordValue)[key] = value(depth + 1);
        }
        white();
        if (source[index] === close) { index++; return result; }
        if (source[index++] !== ",") fail("invalid JSON separator");
      }
      fail("unterminated JSON collection");
    }
    for (const [literal, result] of [["null", null], ["true", true], ["false", false]] as const) {
      if (source.startsWith(literal, index)) { index += literal.length; return result; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (!number) fail("invalid JSON value");
    index += number[0].length;
    return number[0];
  }
  const result = object(value(), "snapshot"); white();
  if (index !== source.length) fail("trailing JSON content");
  return result;
}

function records(snapshot: RecordValue, key: string): RecordValue[] {
  const rows = snapshot[key];
  if (!Array.isArray(rows)) fail(key + " must be an array");
  return rows.map(row => object(row, key + " row"));
}
function decimal(row: RecordValue, field: string, required = false, positive = false, negative = false) {
  if (row[field] == null && !required) return;
  const text = string(row[field], field);
  if (!DECIMAL.test(text)) fail("invalid decimal " + field);
  const nonzero = /[1-9]/.test(text.split(/[eE]/)[0]);
  if ((!negative && text.startsWith("-") && nonzero) || (positive && !nonzero)) fail("invalid sign/quantity for " + field);
}
function entityKey(row: RecordValue, kind: string): string {
  if (kind === "return_allocations") return uuid(row.return_item_id, "return_item_id") + ":" + uuid(row.sale_item_cost_id, "sale_item_cost_id");
  if (kind === "audit_events") {
    const id = string(row.id, "audit event ID");
    if (!/^(?:0|[1-9]\d*)$/.test(id)) fail("invalid audit event ID");
    return id;
  }
  return uuid(row.id, kind + " ID");
}
function parseInvoice(invoice: ArchiveInvoice, guard: Budget): ParsedInvoice {
  guard.check(); uuid(invoice.saleId, "sale ID"); timestamp(invoice.completedAt, "completion timestamp");
  if (!HASH.test(invoice.sourceHash) || typeof invoice.payload !== "string" || Buffer.byteLength(invoice.payload, "utf8") > guard.limits.maxPayloadBytes) fail("invalid snapshot hash/payload size");
  if (hash(invoice.payload) !== invoice.sourceHash) fail("snapshot SHA-256 mismatch");
  const snapshot = losslessJson(invoice.payload, guard), sale = object(snapshot.sale, "sale");
  if (uuid(sale.id, "sale.id") !== invoice.saleId || string(sale.completed_at, "sale.completed_at") !== invoice.completedAt) fail("snapshot identity mismatch");
  if (!records(snapshot, "items").length) fail("invoice must have at least one item");
  for (const field of ["created_by", "idempotency_key"]) if (sale[field] != null) uuid(sale[field], "sale." + field);
  for (const key of ["subtotal", "discount", "net_total"]) decimal(sale, key, true);
  decimal(sale, "extra_charge_amount");
  if (snapshot.cashier !== null) {
    const cashier = object(snapshot.cashier, "cashier");
    if (cashier.id != null) uuid(cashier.id, "cashier.id");
  }
  const ids = new Map<string, Set<string>>();
  for (const kind of ENTITIES) {
    const seen = new Set<string>(); ids.set(kind, seen);
    for (const row of records(snapshot, kind)) {
      const key = entityKey(row, kind);
      if (seen.has(key)) fail("duplicate " + kind + " ID"); seen.add(key);
      if (row.sale_id != null && row.sale_id !== invoice.saleId) fail("cross-invoice " + kind + " row");
      for (const field of ["sale_id", "medicine_id", "batch_id", "sale_item_id", "return_id", "return_item_id", "sale_item_cost_id", "created_by", "received_by", "requested_by", "reviewed_by", "performed_by", "actor_id"]) if (row[field] != null) uuid(row[field], kind + "." + field);
      for (const field of ["quantity", "base_quantity"]) if (row[field] != null) decimal(row, field, true, kind !== "return_items");
      for (const field of ["unit_price", "line_total", "net_line_total", "item_discount", "amount", "unit_cost", "refund_amount", "tendered_amount", "change_amount", "approved_quantity", "quantity_after"]) decimal(row, field);
      decimal(row, "quantity_delta", false, false, true);
      if (row.base_units_per_sale_unit != null && !/^[1-9]\d*$/.test(string(row.base_units_per_sale_unit, "base_units_per_sale_unit"))) fail("invalid base unit quantity");
      if (kind === "items") { decimal(row, "quantity", true, true); decimal(row, "unit_price", true); decimal(row, "line_total", true); }
      if (kind === "payments") decimal(row, "amount", true, true);
      if (kind === "costs") { decimal(row, "quantity", true, true); decimal(row, "unit_cost", true); }
      if (kind === "returns") decimal(row, "refund_amount", true);
      if (kind === "return_items") decimal(row, "quantity", true, true);
      if (kind === "return_allocations") { decimal(row, "base_quantity", true, true); decimal(row, "unit_cost", true); }
    }
  }
  const link = (kind: string, field: string, target: string) => {
    for (const row of records(snapshot, kind)) if (!ids.get(target)!.has(uuid(row[field], kind + "." + field))) fail("missing " + kind + " relation");
  };
  link("costs", "sale_item_id", "items"); link("return_items", "sale_item_id", "items"); link("return_items", "return_id", "returns");
  link("return_allocations", "return_item_id", "return_items"); link("return_allocations", "sale_item_cost_id", "costs");
  for (const payment of records(snapshot, "payments")) if (payment.return_id != null && !ids.get("returns")!.has(string(payment.return_id, "payment return_id"))) fail("missing payment return relation");
  return { invoice, snapshot };
}

const cellText = (value: Value | undefined) => value == null ? "" : typeof value === "string" ? value : typeof value === "boolean" ? String(value) : JSON.stringify(value);
const columns = (names: string) => names.split(" ");
const SHEETS = [
  { name: "LineItems", kind: "items", fields: columns("id sale_id medicine_id medicine_name medicine_sku quantity unit_label selling_unit base_units_per_sale_unit base_quantity unit_price line_total item_discount net_line_total created_at") },
  { name: "Payments", kind: "payments", fields: columns("id sale_id return_id kind method amount tendered_amount change_amount reference received_by created_at") },
  { name: "Returns", kind: "returns", fields: columns("id sale_id return_number status reason refund_amount requested_by reviewed_by review_notes requested_at reviewed_at created_at") },
  { name: "ReturnItems", kind: "return_items", fields: columns("id return_id sale_item_id quantity approved_quantity restockable created_at") },
  { name: "ReturnAllocations", kind: "return_allocations", fields: columns("return_item_id sale_item_cost_id base_quantity unit_cost") },
  { name: "Costs", kind: "costs", fields: columns("id sale_item_id batch_id quantity unit_cost created_at") },
  { name: "StockMovements", kind: "stock_movements", fields: columns("id medicine_id batch_id kind quantity_delta quantity_after reference_type reference_id reason performed_by created_at") },
  { name: "AuditEvents", kind: "audit_events", fields: columns("id actor_id action entity_type entity_id created_at") },
] as const;
const INVOICE_FIELDS = columns("id invoice_number completed_at status customer_name created_by subtotal discount extra_charge_amount extra_charge_description net_total created_at");
function project(latest: ParsedInvoice[], guard: Budget): Projection[] {
  const sheets: Projection[] = [{ name: "Invoices", headers: [...INVOICE_FIELDS, "cashier_name", "source_sha256"], rows: latest.map(({ invoice, snapshot }) => [...INVOICE_FIELDS.map(field => cellText(object(snapshot.sale, "sale")[field])), cellText(snapshot.cashier && object(snapshot.cashier, "cashier").full_name), invoice.sourceHash]) }];
  for (const specification of SHEETS) {
    const seen = new Set<string>(), rows: Row[] = [];
    for (const { invoice, snapshot } of latest) for (const row of records(snapshot, specification.kind)) {
      guard.check(); const key = entityKey(row, specification.kind);
      if (seen.has(key)) fail("duplicate current " + specification.kind + " ID across invoices"); seen.add(key);
      rows.push([invoice.saleId, ...specification.fields.map(field => cellText(row[field]))]);
    }
    sheets.push({ name: specification.name, headers: ["invoice_id", ...specification.fields], rows });
  }
  return sheets;
}
function latestRevisions(revisions: ArchiveInvoice[], guard: Budget, manifest?: ArchiveManifestEntry[]): ParsedInvoice[] {
  const current = new Map<string, ParsedInvoice>();
  const parsed = revisions.map(invoice => parseInvoice(invoice, guard));
  if (manifest) {
    const snapshots = new Map(parsed.map(entry => [entry.invoice.saleId + ":" + entry.invoice.sourceHash, entry]));
    for (const row of manifest) {
      const entry = snapshots.get(row.saleId + ":" + row.sourceHash);
      if (!entry || current.has(row.saleId)) fail("invalid or duplicate current invoice manifest");
      current.set(row.saleId, entry);
    }
    if (new Set(revisions.map(invoice => invoice.saleId)).size !== current.size) fail("previous invoice missing from manifest");
  } else for (const entry of parsed) current.set(entry.invoice.saleId, entry);
  if (current.size > guard.limits.maxInvoices) fail("invoice limit exceeded");
  return [...current.values()].sort((a, b) => a.invoice.saleId.localeCompare(b.invoice.saleId));
}
function chunks(text: string, maximum: number): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maximum, text.length);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    if (end === start) fail("cell limit cannot hold a Unicode character");
    result.push(text.slice(start, end)); start = end;
  }
  return result;
}
function validateCells(rows: Row[], guard: Budget) {
  if (rows.length > guard.limits.maxRowsPerSheet) fail("worksheet row limit exceeded");
  for (const row of rows) { guard.check(); for (const cell of row) if (cell.length > guard.limits.maxCellCodeUnits) fail("cell text limit exceeded"); }
}
function revisionRows(revisions: ArchiveInvoice[], guard: Budget): Row[] {
  if (revisions.length > guard.limits.maxRevisions) fail("revision limit exceeded");
  const rows: Row[] = [];
  let payloadBytes = 0;
  revisions.forEach((invoice, index) => {
    guard.check(); payloadBytes += Buffer.byteLength(invoice.payload, "utf8");
    if (payloadBytes > guard.limits.maxInflatedBytes) fail("snapshot aggregate byte limit exceeded");
    const parts = chunks(invoice.payload, guard.limits.maxCellCodeUnits);
    if (rows.length + parts.length + 1 > guard.limits.maxRowsPerSheet) fail("worksheet row limit exceeded");
    parts.forEach((part, chunk) => rows.push([String(index + 1), invoice.saleId, invoice.completedAt, invoice.sourceHash, String(chunk + 1), String(parts.length), part]));
  });
  return rows;
}
function addSheet(workbook: ExcelJS.Workbook, projection: Projection, guard: Budget) {
  const rows = [projection.headers, ...projection.rows]; validateCells(rows, guard);
  const sheet = workbook.addWorksheet(projection.name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRows(rows); sheet.getRow(1).font = { bold: true, color: { argb: "FF0F172A" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF5FF" } };
  sheet.columns.forEach((column, index) => { column.width = Math.min(44, Math.max(16, projection.headers[index].length + 2)); column.numFmt = "@"; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: projection.headers.length } };
}
function readRows(sheet: ExcelJS.Worksheet, headers: string[], guard: Budget): Row[] {
  if (sheet.rowCount > guard.limits.maxRowsPerSheet || sheet.columnCount > headers.length || sheet.rowCount < 1) fail("invalid worksheet dimensions: " + sheet.name);
  const rows: Row[] = [];
  for (let row = 1; row <= sheet.rowCount; row++) {
    guard.check(); const values: string[] = [];
    for (let column = 1; column <= headers.length; column++) {
      const value = sheet.getCell(row, column).value;
      if (value != null && typeof value !== "string") fail("non-text/formula cell in " + sheet.name);
      values.push(value ?? "");
    }
    rows.push(values);
  }
  validateCells(rows, guard);
  if (JSON.stringify(rows.shift()) !== JSON.stringify(headers)) fail("worksheet header mismatch: " + sheet.name);
  return rows;
}

/** Bound ZIP inflation before ExcelJS loads the workbook into memory. */
function validateZip(bytes: Uint8Array, guard: Budget) {
  if (!bytes.length || bytes.length > guard.limits.maxBytes) fail("workbook byte limit exceeded");
  const data = Buffer.from(bytes);
  let end = -1;
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65_557); index--) if (data.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  if (end < 0 || end + 22 + data.readUInt16LE(end + 20) !== data.length || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) fail("invalid XLSX ZIP container");
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), offset = data.readUInt32LE(end + 16);
  if (!count || count === 65_535 || count !== data.readUInt16LE(end + 8) || offset + size !== end) fail("unsupported or truncated XLSX ZIP directory");
  let position = offset, inflated = 0;
  const names = new Set<string>();
  for (let entry = 0; entry < count; entry++) {
    guard.check();
    if (position + 46 > end || data.readUInt32LE(position) !== 0x02014b50) fail("invalid XLSX ZIP directory entry");
    const flags = data.readUInt16LE(position + 8), method = data.readUInt16LE(position + 10), compressed = data.readUInt32LE(position + 20), expanded = data.readUInt32LE(position + 24);
    const nameLength = data.readUInt16LE(position + 28), extraLength = data.readUInt16LE(position + 30), commentLength = data.readUInt16LE(position + 32), local = data.readUInt32LE(position + 42);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > end || local + 30 > offset || data.readUInt32LE(local) !== 0x04034b50 || (flags & 1) || ![0, 8].includes(method)) fail("unsupported XLSX ZIP entry");
    const name = data.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    if (names.has(name) || name.includes("..") || name.startsWith("/")) fail("invalid duplicate XLSX ZIP path"); names.add(name);
    inflated += expanded; if (inflated > guard.limits.maxInflatedBytes) fail("workbook inflated byte limit exceeded");
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if (start + compressed > offset) fail("truncated XLSX ZIP entry");
    const content = data.subarray(start, start + compressed);
    const actual = method === 0 ? content : inflateRawSync(content, { maxOutputLength: Math.max(1, Math.min(expanded + 1, guard.limits.maxInflatedBytes)) });
    if (actual.length !== expanded) fail("XLSX ZIP inflation size mismatch");
    position = next;
  }
  if (position !== end) fail("invalid XLSX ZIP directory length");
}

async function inspect(bytes: Uint8Array, expected: InspectWorkbookExpected, guard: Budget): Promise<ArchiveWorkbookInspection> {
  guard.check(); validateZip(bytes, guard);
  const sha256 = hash(bytes);
  if (expected.sha256 !== undefined && (!HASH.test(expected.sha256) || expected.sha256 !== sha256)) fail("workbook SHA-256 mismatch");
  const workbook = new ExcelJS.Workbook();
  // ExcelJS's Buffer declaration predates Node's generic Buffer type.
  await withinBudget(workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]), guard);
  const names = ["Metadata", "Revisions", "Manifest", "Invoices", ...SHEETS.map(sheet => sheet.name)];
  if (workbook.worksheets.length !== names.length || workbook.worksheets.some((sheet, index) => sheet.name !== names[index])) fail("worksheet schema mismatch");
  const metaRows = readRows(workbook.getWorksheet("Metadata")!, ["Key", "Value"], guard);
  if (metaRows.length !== META_KEYS.length || metaRows.some((row, index) => row[0] !== META_KEYS[index])) fail("metadata schema mismatch");
  const metadata = Object.fromEntries(metaRows);
  const integer = (value: string, label: string, zero = false) => { if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (zero ? 0 : 1)) fail("invalid " + label); return Number(value); };
  if (metadata["Schema Version"] !== ARCHIVE_SCHEMA_VERSION) fail("unsupported schema version");
  const generation = integer(metadata.Generation, "generation"), invoiceCount = integer(metadata["Invoice Count"], "invoice count", true), revisionCount = integer(metadata["Revision Count"], "revision count", true);
  const previousSha256 = metadata["Previous SHA-256"] || null, createdAt = metadata["Created At"];
  if (previousSha256 !== null && !HASH.test(previousSha256)) fail("invalid previous workbook hash");
  timestamp(createdAt, "creation timestamp");
  if (expected.generation !== undefined && generation !== expected.generation) fail("workbook generation mismatch");
  if (invoiceCount > guard.limits.maxInvoices || revisionCount > guard.limits.maxRevisions) fail("invoice/revision limit exceeded");
  const rows = readRows(workbook.getWorksheet("Revisions")!, REVISION_HEADERS, guard), revisions: ArchiveInvoice[] = [], seen = new Set<string>();
  let cursor = 0;
  while (cursor < rows.length) {
    const first = rows[cursor], number = integer(first[0], "revision number"), count = integer(first[5], "chunk count");
    if (number !== revisions.length + 1 || count > rows.length - cursor) fail("truncated or unordered revision chunks");
    let payload = "";
    for (let chunk = 0; chunk < count; chunk++) {
      const row = rows[cursor + chunk];
      if (row[0] !== first[0] || row[1] !== first[1] || row[2] !== first[2] || row[3] !== first[3] || row[5] !== first[5] || row[4] !== String(chunk + 1) || !row[6]) fail("revision chunk metadata mismatch");
      payload += row[6];
      if (Buffer.byteLength(payload, "utf8") > guard.limits.maxPayloadBytes) fail("snapshot payload limit exceeded");
    }
    const key = first[1] + ":" + first[3]; if (seen.has(key)) fail("duplicate snapshot revision"); seen.add(key);
    revisions.push({ saleId: first[1], completedAt: first[2], sourceHash: first[3], payload }); cursor += count;
  }
  if (revisions.length !== revisionCount) fail("revision count mismatch");
  const currentManifest = readRows(workbook.getWorksheet("Manifest")!, MANIFEST_HEADERS, guard).map(row => ({ saleId: row[0], sourceHash: row[1] }));
  const latest = latestRevisions(revisions, guard, currentManifest);
  if (latest.length !== invoiceCount) fail("invoice count mismatch");
  for (const projection of project(latest, guard)) {
    const actual = readRows(workbook.getWorksheet(projection.name)!, projection.headers, guard);
    if (JSON.stringify(actual) !== JSON.stringify(projection.rows)) fail("derived current rows mismatch: " + projection.name);
  }
  const manifest = latest.map(({ invoice }) => ({ saleId: invoice.saleId, sourceHash: invoice.sourceHash }));
  if (expected.manifest !== undefined) {
    const sorted = [...expected.manifest].sort((a, b) => a.saleId.localeCompare(b.saleId));
    if (JSON.stringify(manifest) !== JSON.stringify(sorted)) fail("workbook manifest mismatch");
  }
  guard.check();
  return { sha256, generation, previousSha256, createdAt, invoiceCount, revisionCount, manifest, invoices: latest.map(entry => entry.invoice), revisions };
}

export async function inspectWorkbook(bytes: Uint8Array, expected: InspectWorkbookExpected = {}): Promise<ArchiveWorkbookInspection> {
  try { return await inspect(bytes, expected, budget(expected.limits)); }
  catch (error) { if (error instanceof Error && error.message.startsWith("Invoice archive:")) throw error; fail("invalid or corrupt XLSX workbook"); }
}

export async function buildWorkbook(previous: Uint8Array | null, invoices: ArchiveInvoice[], options: BuildWorkbookOptions): Promise<ArchiveWorkbookBuild> {
  const guard = budget(options.limits); timestamp(options.createdAt, "creation timestamp");
  if (!Number.isSafeInteger(options.generation) || options.generation < 1) fail("invalid generation");
  if ((previous === null) !== (options.previousSha256 === null)) fail("previous workbook hash is required exactly when a predecessor exists");
  const prior = previous === null ? null : await inspect(previous, { sha256: options.previousSha256! }, guard);
  if (prior && options.generation !== prior.generation + 1) fail("generation must follow predecessor");
  const revisions = prior ? [...prior.revisions] : [], seen = new Set(revisions.map(invoice => invoice.saleId + ":" + invoice.sourceHash));
  const current = new Map((prior?.invoices ?? []).map(invoice => [invoice.saleId, invoice]));
  let payloadBytes = revisions.reduce((total, invoice) => total + Buffer.byteLength(invoice.payload, "utf8"), 0);
  const incoming = new Set<string>();
  for (const invoice of invoices) {
    parseInvoice(invoice, guard);
    if (incoming.has(invoice.saleId)) fail("duplicate incoming invoice ID"); incoming.add(invoice.saleId);
    current.set(invoice.saleId, invoice);
    const key = invoice.saleId + ":" + invoice.sourceHash;
    if (!seen.has(key)) {
      if (revisions.length >= guard.limits.maxRevisions) fail("revision limit exceeded");
      payloadBytes += Buffer.byteLength(invoice.payload, "utf8");
      if (payloadBytes > guard.limits.maxInflatedBytes) fail("snapshot aggregate byte limit exceeded");
      revisions.push({ ...invoice }); seen.add(key);
    }
  }
  const currentManifest = [...current.values()].map(invoice => ({ saleId: invoice.saleId, sourceHash: invoice.sourceHash }));
  const latest = latestRevisions(revisions, guard, currentManifest), projections = project(latest, guard);
  const workbook = new ExcelJS.Workbook(); workbook.creator = "Qeilvra"; workbook.created = new Date(options.createdAt); workbook.modified = new Date(options.createdAt);
  addSheet(workbook, { name: "Metadata", headers: ["Key", "Value"], rows: META_KEYS.map((key, index) => [key, [ARCHIVE_SCHEMA_VERSION, String(options.generation), options.previousSha256 ?? "", options.createdAt, String(latest.length), String(revisions.length)][index]]) }, guard);
  addSheet(workbook, { name: "Revisions", headers: REVISION_HEADERS, rows: revisionRows(revisions, guard) }, guard);
  addSheet(workbook, { name: "Manifest", headers: MANIFEST_HEADERS, rows: latest.map(({ invoice }) => [invoice.saleId, invoice.sourceHash]) }, guard);
  for (const projection of projections) addSheet(workbook, projection, guard);
  const bytes = new Uint8Array(await withinBudget(workbook.xlsx.writeBuffer(), guard));
  if (bytes.byteLength > guard.limits.maxBytes) fail("workbook byte limit exceeded");
  const manifest = latest.map(({ invoice }) => ({ saleId: invoice.saleId, sourceHash: invoice.sourceHash }));
  // Verify our emitted bytes as strictly as the separately downloaded storage copy.
  const verified = await inspect(bytes, { generation: options.generation, manifest }, guard);
  return { bytes, sha256: verified.sha256, invoiceCount: verified.invoiceCount, revisionCount: verified.revisionCount, manifest: verified.manifest };
}
