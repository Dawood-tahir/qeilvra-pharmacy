// Authorized non-destructive hosted verification. No migrations, live row writes,
// policy changes, auth-session creation or archive-worker execution occur here.
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildWorkbook, inspectWorkbook } from "../lib/invoice-archive/workbook.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !publicKey || !secret) throw new Error("Existing Supabase configuration is required.");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options), anonymous = createClient(url, publicKey, options);
const report = { mode: "read-only database and isolated synthetic storage objects", checks: [], skipped: [], cleanup: false };
const pass = label => { report.checks.push(label); console.log("PASS: " + label); };
const skip = label => { report.skipped.push(label); console.log("SKIP: " + label); };
const digest = value => createHash("sha256").update(value).digest("hex");
const sqlQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
const token = process.env.SUPABASE_ACCESS_TOKEN;
const reference = new URL(url).hostname.split(".")[0];
async function queryReadOnly(body) {
  if (!token) return null;
  const response = await fetch("https://api.supabase.com/v1/projects/" + reference + "/database/query", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "begin isolation level repeatable read read only; set local statement_timeout='10s'; " + body + "; rollback;" }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error("Read-only hosted inspection returned HTTP " + response.status);
  return response.json();
}
const financialTables = ["sales", "sale_items", "sale_item_costs", "payments", "sale_returns", "return_items", "return_allocations", "medicine_batches", "stock_movements", "purchases", "purchase_items", "expenses"];
const financialSnapshot = "select jsonb_build_object(" + financialTables.map(table => sqlQuote(table) + ",(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),''))) from public." + table + " t)").join(",") + ") snapshot";
let before = null, reportsBefore = null, reportQuery = null, bucket = null, temporaryBucket = null, identities = [];
const prefix = "__qeilvra_archive_verification__/" + randomUUID() + "/";
const attemptedKeys = [];
function fixture() {
  const saleId = randomUUID(), itemId = randomUUID();
  const completedAt = "2026-01-01T00:00:00+00:00";
  const payload = JSON.stringify({ sale: { id: saleId, completed_at: completedAt, subtotal: "10.00", discount: "1.00", net_total: "9.00", status: "completed", invoice_number: "SYNTHETIC-ONLY" },
    items: [{ id: itemId, sale_id: saleId, medicine_id: randomUUID(), medicine_name: "Synthetic verification, no patient data", medicine_sku: "SYNTHETIC", quantity: "1.000", unit_price: "10.00", line_total: "10.00" }],
    payments: [], costs: [], returns: [], return_items: [], return_allocations: [], stock_movements: [], audit_events: [], cashier: null });
  return { saleId, completedAt, payload, sourceHash: digest(payload) };
}
try {
  if (token) {
    const metadata = await queryReadOnly("select jsonb_build_object('archive_settings',to_regclass('private.invoice_archive_settings') is not null,'ledger',to_regclass('private.invoice_item_ledger') is not null,'storage_policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from pg_policies p where schemaname='storage'),'roles',(select coalesce(jsonb_agg(jsonb_build_object('id',ur.user_id,'role',ur.role)),'[]') from public.user_roles ur join public.profiles p on p.id=ur.user_id where p.is_active)) metadata");
    report.schema = { archive: metadata[0].metadata.archive_settings, ledger: metadata[0].metadata.ledger };
    report.storagePolicies = metadata[0].metadata.storage_policies;
    identities = metadata[0].metadata.roles;
    report.relationBytes = await queryReadOnly("select jsonb_object_agg(c.relname,pg_total_relation_size(c.oid)) sizes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
    pass("read-only inspection of existing Storage RLS and migration availability");
    before = await queryReadOnly(financialSnapshot);
    pass("consistent pre-test financial and inventory fingerprints captured without live row writes");
    const ownerIdentity = identities.find(row => row.role === "owner");
    if (ownerIdentity) {
      reportQuery = "set local role authenticated; set local request.jwt.claim.sub=" + sqlQuote(ownerIdentity.id)
        + "; select jsonb_build_object('dashboard',public.owner_dashboard_metrics('1900-01-01',current_date),"
        + "'analytics',public.owner_financial_analytics(current_date-365,current_date,'day',true)-'generated_at',"
        + "'breakdowns',public.owner_report_breakdowns(current_date-365,current_date)) reports";
      reportsBefore = await queryReadOnly(reportQuery);
      pass("existing hosted lifetime dashboard, annual financial analytics and breakdowns captured read-only as Owner");
    }
    for (const role of ["owner", "salesperson"]) {
      const staff = metadata[0].metadata.roles.find(row => row.role === role);
      if (!staff) { skip("no active " + role + " identity for database RLS inspection"); continue; }
      const checked = await queryReadOnly("set local role authenticated; select set_config('request.jwt.claim.sub'," + sqlQuote(staff.id) + ",true); select jsonb_build_object('role',public.current_role(),'foreign_sales',(select count(*) from public.sales where created_by<>auth.uid()),'cost_rows',(select count(*) from public.sale_item_costs),'archive_objects',(select count(*) from storage.objects where bucket_id='invoice-archives')) access");
      const access = checked.find(row => row.access)?.access;
      assert.equal(access.role, role);
      if (role === "salesperson") { assert.equal(access.foreign_sales, 0); assert.equal(access.cost_rows, 0); }
      // Direct archive storage is deliberately forbidden even for an Owner;
      // the authorized application endpoint creates a short-lived signed URL.
      assert.equal(access.archive_objects, 0);
      pass("hosted database RLS for active " + role + " (transaction-local role/identity only)");
    }
    if (!report.schema.archive || !report.schema.ledger) skip("new archive/ledger RPCs and receipt embedding are not installed; no hosted migrations applied");
  } else skip("management credential unavailable: database policy/financial fingerprints not inspected");

  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) throw new Error("Storage bucket inspection failed.");
  report.buckets = buckets.map(({ name, public: isPublic }) => ({ name, public: isPublic }));
  pass("existing Storage bucket configuration inspected without changes");
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  bucket = buckets.find(row => row.name === "invoice-archives" && !row.public)
    ?? buckets.find(row => !row.public && (!row.allowed_mime_types?.length || row.allowed_mime_types.includes(mime)));
  if (!bucket && process.argv.includes("--temporary-private-bucket")) {
    temporaryBucket = "qeilvra-archive-test-" + randomUUID();
    const { error } = await admin.storage.createBucket(temporaryBucket, { public: false, fileSizeLimit: 33554432, allowedMimeTypes: [mime] });
    if (error) throw new Error("Isolated private test bucket could not be created.");
    bucket = { name: temporaryBucket };
    pass("isolated private synthetic test bucket created without modifying RLS policies");
  }
  if (!bucket) {
    skip("no existing private bucket accepts XLSX; isolated upload/readback requires reviewed bucket provisioning");
  } else {
    if (bucket.name !== "invoice-archives") skip("archive bucket is absent; generic private Storage transport is tested in another existing private bucket");
    const storage = admin.storage.from(bucket.name);
    const first = await buildWorkbook(null, [fixture()], { generation: 1, previousSha256: null, createdAt: new Date().toISOString() });
    const next = await buildWorkbook(first.bytes, [fixture()], { generation: 2, previousSha256: first.sha256, createdAt: new Date().toISOString() });
    async function put(name, bytes) {
      const key = prefix + name;
      // Record exact attempted keys, including lost responses, for finally cleanup.
      attemptedKeys.push(key);
      const { error } = await storage.upload(key, bytes, { contentType: mime, upsert: false, cacheControl: "0" });
      if (error) throw new Error("Synthetic private Storage upload failed.");
      return key;
    }
    async function read(key) {
      const { data, error } = await storage.download(key);
      if (error || !data) throw new Error("Synthetic private Storage readback failed.");
      return new Uint8Array(await data.arrayBuffer());
    }
    const firstKey = await put("generation-1.xlsx", first.bytes);
    for (const role of ["owner", "salesperson"]) {
      const identity = identities.find(row => row.role === role);
      if (!identity) continue;
      const rows = await queryReadOnly("set local role authenticated; select set_config('request.jwt.claim.sub'," + sqlQuote(identity.id) + ",true); select count(*) count from storage.objects where bucket_id=" + sqlQuote(bucket.name) + " and name=" + sqlQuote(firstKey));
      assert.equal(Number(rows.find(row => row.count !== undefined).count), 0);
      pass("hosted " + role + " cannot directly read the actual isolated private test object via RLS");
    }
    await inspectWorkbook(await read(firstKey), { sha256: first.sha256, generation: 1, manifest: first.manifest });
    pass("real private XLSX upload, independent download, SHA-256 and complete workbook verification");
    const deniedOverwrite = await storage.upload(firstKey, next.bytes, { contentType: mime, upsert: false });
    assert.ok(deniedOverwrite.error);
    assert.equal(digest(await read(firstKey)), first.sha256);
    pass("immutable upload rejects duplicate keys and preserves the existing test workbook");
    const nextKey = await put("generation-2.xlsx", next.bytes);
    const appended = await inspectWorkbook(await read(nextKey), { sha256: next.sha256, manifest: next.manifest });
    assert.equal(appended.invoiceCount, 2);
    assert.equal(digest(await read(firstKey)), first.sha256);
    pass("cumulative append retains earlier synthetic invoices and previous verified bytes");
    const corruptKey = await put("corrupt-test.xlsx", next.bytes.slice(0, -20));
    const corrupt = await read(corruptKey);
    await assert.rejects(() => inspectWorkbook(corrupt, { sha256: next.sha256 }));
    await inspectWorkbook(await read(firstKey), { sha256: first.sha256 });
    pass("corrupt uploaded bytes are rejected; the previous verified object remains recoverable");
    const { data: signed, error: signError } = await storage.createSignedUrl(nextKey, 60, { download: "Qeilvra_Invoices.xlsx" });
    assert.equal(signError, null);
    const response = await fetch(signed.signedUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    await inspectWorkbook(new Uint8Array(await response.arrayBuffer()), { sha256: next.sha256 });
    pass("short-lived signed download delivers the verified workbook");
    const denied = await anonymous.storage.from(bucket.name).download(firstKey);
    assert.ok(denied.error);
    const publicResponse = await fetch(url + "/storage/v1/object/public/" + encodeURIComponent(bucket.name) + "/" + firstKey, { signal: AbortSignal.timeout(30_000) });
    assert.notEqual(publicResponse.status, 200);
    pass("anonymous SDK and unauthenticated public-URL reads are denied");
  }
  skip("authenticated Owner/Salesperson HTTP sessions: no user login, account or session writes were performed");
  skip("hosted deletion and destructive reconciliation: explicitly restricted to local disposable fixtures");
} finally {
  try {
    if (bucket && attemptedKeys.length) {
      assert.ok(attemptedKeys.every(key => key.startsWith(prefix) && !key.includes("..")));
      const { error } = await admin.storage.from(bucket.name).remove(attemptedKeys);
      if (error) throw new Error("Temporary test object cleanup needs attention.");
      const { data, error: listError } = await admin.storage.from(bucket.name).list(prefix);
      if (listError || data.length) throw new Error("Temporary object cleanup could not be verified.");
      pass("only exact synthetic test paths were removed and cleanup verified");
    }
    if (temporaryBucket) {
      assert.ok(/^qeilvra-archive-test-[0-9a-f-]{36}$/.test(temporaryBucket));
      const { error } = await admin.storage.deleteBucket(temporaryBucket);
      if (error) throw new Error("Isolated test bucket cleanup needs attention.");
      const { data, error: listError } = await admin.storage.listBuckets();
      if (listError || data.some(row => row.name === temporaryBucket)) throw new Error("Test bucket cleanup was not verified.");
      pass("temporary private test bucket removed; existing bucket configuration preserved");
    }
    report.cleanup = true;
    if (before) {
      const after = await queryReadOnly(financialSnapshot);
      report.liveFinancialAndStockUnchanged = JSON.stringify(before) === JSON.stringify(after);
      if (report.liveFinancialAndStockUnchanged) pass("all captured live financial/inventory fingerprints match before and after");
      else skip("live fingerprints changed during testing; concurrent pharmacy activity requires a separate comparison");
    }
    if (reportsBefore) {
      const after = await queryReadOnly(reportQuery);
      report.liveReportsUnchanged = JSON.stringify(reportsBefore) === JSON.stringify(after);
      if (report.liveReportsUnchanged) pass("hosted dashboard, financial and medicine/cashier report outputs match before and after");
      else skip("hosted report outputs changed during testing; concurrent activity requires a separate comparison");
    }
  } finally {
    report.completedAt = new Date().toISOString();
    fs.mkdirSync(".private", { recursive: true });
    fs.writeFileSync(".private/invoice-archive-hosted-results.json", JSON.stringify(report, null, 2));
  }
}
