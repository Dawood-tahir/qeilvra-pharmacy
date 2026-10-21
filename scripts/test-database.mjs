import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const bin = process.env.PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "");
const exe = (name) => bin ? path.join(bin, name + (process.platform === "win32" ? ".exe" : "")) : name;
const data = path.resolve(".local-test-db");
const port = "55439";
const base = ["-h", "127.0.0.1", "-p", port, "-U", "postgres"];
let started = false;
const databases = [];
const run = (name, args, input) => execFileSync(exe(name), args, { encoding: "utf8", windowsHide: true, input, stdio: ["pipe", "pipe", "pipe"] });
function sql(db, text) { return run("psql", [...base, "-X", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq"], text); }
function file(db, name) {
  try {
    const result = execFileSync(exe("psql"), [...base, "-X", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq", "-f", name], { encoding: "utf8", windowsHide: true });
    return result;
  } catch (e) { throw new Error("Database check failed in " + name + ": " + (e.stderr ?? e.message)); }
}
function parallelSql(db, text) {
  return new Promise((resolve) => {
    const child = spawn(exe("psql"), [...base, "-X", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq"], { windowsHide: true });
    let out = "", error = "";
    child.stdout.on("data", (d) => out += d); child.stderr.on("data", (d) => error += d);
    child.on("close", (code) => resolve({ code, out, error }));
    child.stdin.end(text);
  });
}
const quoteSql = value => "'" + String(value).replaceAll("'", "''") + "'";
const serviceSql = "set role service_role; ";
const ownerSql = "set role authenticated; set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001'; ";
function jsonSql(db, statement) { return JSON.parse(sql(db, statement).trim().split(/\r?\n/).at(-1)); }
async function archiveWorkbookIntegration(db) {
  // Node 22.18+/24 can strip the codec's erasable TypeScript syntax. This runs
  // the same production codec against exact PostgreSQL payloads, without any
  // Supabase credentials, Storage requests or changes outside this disposable DB.
  const { buildWorkbook, inspectWorkbook } = await import("../lib/invoice-archive/workbook.ts");
  const medicine = sql(db, "select id from public.test_ids where label='medicine'").trim();
  const partialId = sql(db, ownerSql + "select sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id'," + quoteSql(medicine) + "::uuid,'unit_key','base','quantity',2)),'cash',14,0,gen_random_uuid())").trim();
  const partialItem = sql(db, "select id from public.sale_items where sale_id=" + quoteSql(partialId)).trim();
  jsonSql(db, ownerSql + "select public.complete_sale_return(" + quoteSql(partialId) + ",jsonb_build_array(jsonb_build_object('sale_item_id'," + quoteSql(partialItem) + "::uuid,'quantity',1,'in_base_units',true,'restockable',true)),'Local archive XLSX fixture refund',gen_random_uuid())");
  const selected = jsonSql(db, "select jsonb_agg(to_jsonb(t)) from (select distinct on(status) id,status from public.sales where status in ('completed','partially_refunded','refunded') order by status,id)t");
  assert.deepEqual(selected.map(row => row.status).sort(), ["completed", "partially_refunded", "refunded"]);
  const firstIds = selected.filter(row => row.status !== "refunded").map(row => row.id);
  const lastId = selected.find(row => row.status === "refunded").id;
  sql(db, "update public.sales set completed_at=clock_timestamp()-interval '18 days' where id in (" + firstIds.map(quoteSql).join(",") + "); update public.sales set completed_at=clock_timestamp()-interval '14 days' where id=" + quoteSql(lastId) + "; update private.invoice_archive_settings set enabled=true;");

  const contenders = await Promise.all([parallelSql(db, serviceSql + "select public.invoice_archive_claim()"), parallelSql(db, serviceSql + "select public.invoice_archive_claim()")]);
  assert.ok(contenders.every(result => result.code === 0), JSON.stringify(contenders));
  const claims = contenders.map(result => JSON.parse(result.out.trim()));
  assert.deepEqual(claims.map(row => row.status).sort(), ["busy", "claimed"]);
  const claim = claims.find(row => row.status === "claimed");
  const leaseArgs = quoteSql(claim.lease) + "::uuid," + claim.fence;
  let batch = jsonSql(db, serviceSql + "select public.invoice_archive_batch(" + leaseArgs + ",100)");
  assert.ok(firstIds.every(id => batch.candidates.some(row => row.sale_id === id)));
  assert.ok(!batch.candidates.some(row => row.sale_id === lastId));
  const asInvoice = row => ({ saleId: row.sale_id, completedAt: row.completed_at, sourceHash: row.source_sha256, payload: row.payload_text });
  const built = await buildWorkbook(null, batch.candidates.map(asInvoice), { generation: 1, previousSha256: null, createdAt: new Date().toISOString() });
  let readBack = await inspectWorkbook(built.bytes, { sha256: built.sha256, generation: 1, manifest: built.manifest });
  assert.deepEqual(readBack.invoices, batch.candidates.map(asInvoice).sort((a,b) => a.saleId.localeCompare(b.saleId)));

  const canonicalTables = ["sales", "invoice_item_rows", "sale_item_costs", "payments", "sale_returns", "return_items", "return_allocations", "medicine_batches", "medicines", "medicine_units", "medicine_costs", "stock_movements", "purchases", "purchase_items", "stock_receipts", "expenses", "expense_categories", "stock_dispositions", "suppliers", "profiles", "user_roles", "pharmacy_settings"];
  const fingerprints = canonicalTables.flatMap(table => [quoteSql(table), "(select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public." + table + " t)"]).join(",");
  const snapshot = () => jsonSql(db, ownerSql + "select jsonb_build_object('canonical',jsonb_build_object(" + fingerprints + "),'financial',public.owner_financial_analytics(current_date-365,current_date,'day',true)-'generated_at','dashboard',public.owner_dashboard_metrics('1900-01-01',current_date),'breakdowns',public.owner_report_breakdowns(current_date-365,current_date))");
  const before = snapshot();
  const receiptQuery = ownerSql + "select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.sales s cross join lateral public.sale_items(s) i where s.id in (" + firstIds.map(quoteSql).join(",") + ")";
  const receiptBefore = jsonSql(db, receiptQuery);
  const commitSql = (workbook, generation) => "select public.invoice_archive_commit(" + leaseArgs + "," + generation + "," + quoteSql("versions/" + (generation+1) + "/" + claim.lease + "-" + workbook.sha256 + ".xlsx") + "," + quoteSql(workbook.sha256) + "," + workbook.bytes.length + "," + quoteSql(JSON.stringify(workbook.manifest.map(row => ({ sale_id: row.saleId, source_sha256: row.sourceHash })))) + "::jsonb)";
  const published = jsonSql(db, serviceSql + commitSql(built, 0));
  assert.equal(published.deleted_count, 0);
  assert.deepEqual(snapshot(), before);
  assert.equal(jsonSql(db, serviceSql + "select public.invoice_archive_current()").sha256, built.sha256);
  const pruneSql = (workbook, generation, key) => "select public.invoice_archive_prune(" + leaseArgs + "," + generation + "," + quoteSql(workbook.sha256) + "," + quoteSql(key) + ",100)";
  assert.equal(jsonSql(db, serviceSql + pruneSql(built, 1, randomUUID())).status, "deletion_disabled");
  sql(db, "update private.invoice_archive_settings set deletion_enabled=true;");
  sql(db, "alter table public.sale_items add column invoice_schema_probe text;");
  assert.throws(() => sql(db, serviceSql + pruneSql(built, 1, randomUUID())), /Invoice ledger schema changed/);
  sql(db, "alter table public.sale_items drop column invoice_schema_probe;");
  // A failure after DELETE must also roll back every preceding ledger write.
  sql(db, "create function private.invoice_test_inject_failure() returns trigger language plpgsql as $$begin raise exception 'Injected archive deletion interruption'; end$$; create trigger invoice_test_inject_failure after delete on public.sale_items for each row execute function private.invoice_test_inject_failure();");
  const activeBeforeFailure = sql(db, "select count(*) from public.sale_items").trim();
  assert.throws(() => sql(db, serviceSql + pruneSql(built, 1, randomUUID())), /Injected archive deletion interruption/);
  assert.equal(sql(db, "select count(*) from public.sale_items").trim(), activeBeforeFailure);
  assert.equal(sql(db, "select count(*) from private.invoice_item_ledger where archived").trim(), "0");
  assert.deepEqual(snapshot(), before);
  sql(db, "drop trigger invoice_test_inject_failure on public.sale_items; drop function private.invoice_test_inject_failure();");
  const firstPrune = pruneSql(built, 1, randomUUID());
  const pruned = jsonSql(db, serviceSql + firstPrune);
  assert.ok(pruned.deleted_count > 0);
  assert.equal(jsonSql(db, serviceSql + firstPrune).deleted_count, pruned.deleted_count);
  assert.equal(sql(db, "select count(*) from public.sale_items where sale_id in (" + firstIds.map(quoteSql).join(",") + ")").trim(), "0");
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(jsonSql(db, receiptQuery), receiptBefore);
  assert.equal(sql(db, "set role authenticated; set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002'; select count(*) from public.invoice_item_rows i join public.sales s on s.id=i.sale_id where s.created_by<>auth.uid()").trim(), "0");
  assert.equal(jsonSql(db, serviceSql + pruneSql(built, 1, randomUUID())).deleted_count, 0);
  console.log("PASS: real verified XLSX permits atomic original-line deletion, exact replay, zero duplicate deletion and unchanged financial/stock fingerprints");
  console.log("PASS: concurrent archive claims serialize; real SQL snapshots round-trip through verified XLSX and preserve all canonical rows/reports");

  // Append a newly eligible fully refunded invoice and a corrected old snapshot.
  // The original raw revision and all previously archived IDs must survive.
  sql(db, "update public.sales set completed_at=clock_timestamp()-interval '18 days' where id=" + quoteSql(lastId) + "; update public.sales set customer_name='Local archive revision' where id=" + quoteSql(firstIds[0]));
  batch = jsonSql(db, serviceSql + "select public.invoice_archive_batch(" + leaseArgs + ",100)");
  assert.ok(batch.candidates.some(row => row.sale_id === lastId));
  assert.ok(batch.candidates.some(row => row.sale_id === firstIds[0]));
  const next = await buildWorkbook(built.bytes, batch.candidates.map(asInvoice), { generation: 2, previousSha256: built.sha256, createdAt: new Date().toISOString() });
  readBack = await inspectWorkbook(next.bytes, { sha256: next.sha256, generation: 2, manifest: next.manifest });
  assert.ok(built.manifest.every(previous => readBack.manifest.some(row => row.saleId === previous.saleId)));
  assert.equal(readBack.revisionCount, built.revisionCount + batch.candidates.length);
  assert.ok(readBack.revisions.some(row => row.saleId === firstIds[0] && row.sourceHash === built.manifest.find(row => row.saleId === firstIds[0]).sourceHash));
  const archivedPayloads = () => jsonSql(db, "select jsonb_agg(jsonb_build_object('id',s.id,'payload',private.invoice_archive_payload(s.id)) order by s.id) from public.sales s where s.id in (" + readBack.invoices.map(row => quoteSql(row.saleId)).join(",") + ")");
  const sourcesBefore = archivedPayloads();
  const stockBefore = Number(sql(db, "select sum(quantity_on_hand) from public.medicine_batches where medicine_id=" + quoteSql(medicine)).trim());
  const salesBefore = Number(sql(db, "select count(*) from public.sales").trim());
  // Hold the publishing transaction open after it has written archive metadata.
  // A real unrelated checkout must finish while that transaction is still open.
  const holdingCommit = parallelSql(db, "begin; " + serviceSql + commitSql(next, 1) + "; select pg_advisory_xact_lock(210016,1); select pg_sleep(2); commit;");
  const waitUntil = Date.now() + 10_000;
  while (sql(db, "select exists(select 1 from pg_locks where database=(select oid from pg_database where datname=current_database()) and locktype='advisory' and classid=210016 and objid=1)").trim() !== "t") {
    assert.ok(Date.now() < waitUntil, "Archive publication did not reach the concurrency probe");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const checkout = await parallelSql(db, ownerSql + "set statement_timeout='500ms'; select sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id'," + quoteSql(medicine) + "::uuid,'unit_key','base','quantity',1)),'cash',7,0,gen_random_uuid());");
  const committed = await holdingCommit;
  assert.equal(checkout.code, 0, checkout.error);
  assert.equal(committed.code, 0, committed.error);
  const secondPrune = jsonSql(db, serviceSql + pruneSql(next, 2, randomUUID()));
  assert.ok(secondPrune.deleted_count>0);
  assert.deepEqual(archivedPayloads(), sourcesBefore);
  assert.equal(Number(sql(db, "select count(*) from public.sales").trim()), salesBefore + 1);
  assert.equal(Number(sql(db, "select sum(quantity_on_hand) from public.medicine_batches where medicine_id=" + quoteSql(medicine)).trim()), stockBefore - 1);
  assert.equal(jsonSql(db, serviceSql + "select public.invoice_archive_current()").sha256, next.sha256);
  jsonSql(db, serviceSql + "select public.invoice_archive_release(" + leaseArgs + ")");
  sql(db, "update private.invoice_archive_settings set enabled=false,deletion_enabled=false;");
  console.log("PASS: real refunded/updated SQL snapshots append without losing revisions; archive publication permits concurrent POS with exactly one stock deduction");
}
try {
  if (!fs.existsSync(path.join(data, "PG_VERSION"))) run("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale", "-E", "UTF8"]);
  try { run("pg_ctl", ["-D", data, "status"]); } catch {
    // A background postgres process can inherit captured pipe handles on Windows
    // and leave execFileSync waiting after pg_ctl has already exited.
    execFileSync(exe("pg_ctl"), ["-D", data, "-l", path.resolve(".local-test-db.log"), "-o", "-p " + port + " -h 127.0.0.1", "start"], { windowsHide: true, stdio: "ignore", timeout: 60000 });
    started = true;
  }
  // Refuse even local/forwarded servers unless this is our workspace test cluster.
  // Explicit host/port/database flags and -X also ignore production connection
  // defaults and user psql startup commands.
  const normalizePath = value => {
    const resolved = fs.realpathSync(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  assert.equal(normalizePath(sql("postgres", "show data_directory").trim()), normalizePath(data), "Refusing to run database tests outside the workspace test cluster");
  const migrations = fs.readdirSync("supabase/migrations").sort();
  for (const legacy of [true, false]) {
    const db = "qeilvra_contract_" + process.pid + (legacy ? "_legacy" : "");
    run("createdb", [...base, db]); databases.push(db);
    file(db, "tests/database/bootstrap.sql");
    for (const migration of migrations) {
      // Exercise historical pricing/return contracts before the replacement, then
      // verify the final workflow and concurrent writes on the upgraded database.
      if (!legacy && migration >= "202610190012") continue;
      if (legacy && migration.startsWith("202610180005")) file(db, "tests/database/legacy-before.sql");
      if (!legacy && migration.startsWith("202610190011")) {
        const original = sql(db, "select pg_get_functiondef('private.inventory_search(text,integer,integer,text,text)'::regprocedure)");
        sql(db, original.replace("private.inventory_search(", "private.audit_inventory_before(") + ";\ngrant execute on function private.audit_inventory_before(text,integer,integer,text,text) to authenticated;");
      }
      file(db, "supabase/migrations/" + migration);
    }
    if (legacy) { file(db, "tests/database/legacy-after.sql"); console.log("PASS: legacy quantities, costs and history survive migration"); continue; }
    file(db, "tests/database/contracts.sql");
    file(db, "tests/database/edge-cases.sql");
    file(db, "tests/database/supplier-receiving.sql");
    file(db, "tests/database/supplier-profiles.sql");
    file(db, "tests/database/pos-custom-prices.sql");
    file(db, "tests/database/instant-returns.sql");
    file(db, "tests/database/audit-security.sql");
    file(db, "tests/database/inventory-equivalence.sql");
    file(db, "supabase/migrations/202610190012_pos_workflow.sql");
    file(db, "tests/database/pos-workflow.sql");
    file(db, "supabase/migrations/202610190013_financial_analytics.sql");
    file(db, "tests/database/financial-analytics.sql");
    file(db, "supabase/migrations/202610190014_stock_dispositions.sql");
    file(db, "tests/database/stock-dispositions.sql");
    // Also prove the financial fixes work on the hosted pre-ledger schema;
    // rolling this transaction back keeps the original upgrade tests meaningful.
    const standaloneAccuracy = fs.readFileSync("supabase/migrations/202610210018_financial_accuracy.sql", "utf8")
      .replace(/commit;\s*$/, "set local qeilvra.test_accuracy_fixed='true';\n")
      + fs.readFileSync("tests/database/financial-accuracy.sql", "utf8").replace(/^begin;$/m, "");
    sql(db, standaloneAccuracy);
    console.log("PASS: financial accuracy fixes also work without installing or activating invoice archiving");
    file(db, "supabase/migrations/202610200015_supplier_summary.sql");
    file(db, "tests/database/supplier-summary.sql");
    file(db, "supabase/migrations/202610210016_invoice_archives.sql");
    file(db, "tests/database/invoice-archives.sql");
    console.log("PASS: archive cutoff, leases, retries, generations, service permissions and private storage contracts");
    file(db, "tests/database/archive-accounting-equivalence.sql");
    console.log("PASS: archive publication and late returns preserve financial reports, fractional COGS, stock and supplier history");
    file(db, "supabase/migrations/202610210017_invoice_retained_ledger.sql");
    file(db, "tests/database/invoice-ledger.sql");
    file(db, "tests/database/financial-accuracy.sql");
    file(db, "supabase/migrations/202610210018_financial_accuracy.sql");
    sql(db, "alter database " + db + " set qeilvra.test_accuracy_fixed='true';");
    file(db, "tests/database/financial-accuracy.sql");
    console.log("PASS: reproduced and corrected purchase money overflow, stale draft discount allocation and fractional batch loss rounding");
    // Reuse the independent financial oracle against actual line deletion. Only
    // its read source changes; expected amounts/costs/refunds remain literal.
    const ledgerOracle = fs.readFileSync("tests/database/archive-accounting-equivalence.sql", "utf8")
      .replaceAll("public.sale_items", "public.invoice_item_rows").replaceAll("'sale_items'", "'invoice_item_rows'")
      .replace("begin;", `begin;
        update private.invoice_archive_settings set current_version_id=null,generation=0,deletion_enabled=true;
        delete from private.invoice_archive_manifest; delete from private.invoice_archive_versions; delete from private.invoice_archive_runs;`)
      .replace("insert into archive_eq_state values('lease',c),('manifest',m),('first_commit',r);", `
        insert into archive_eq_state values('lease',c),('manifest',m),('first_commit',r);
        r:=public.invoice_archive_prune((c->>'lease')::uuid,(c->>'fence')::bigint,
          (r->>'generation')::bigint,h,gen_random_uuid(),100);
        perform public.test_assert((r->>'deleted_count')::int>0,'verified original invoice lines are actually deleted');`);
    sql(db, ledgerOracle);
    console.log("PASS: real invoice-line deletion preserves independent daily/lifetime financial, stock and late-refund oracles");
    await archiveWorkbookIntegration(db);
    file(db, "tests/database/invoice-ledger-storage.sql");
    const storageMeasurement = jsonSql(db, "select metrics from private.invoice_size_result");
    fs.mkdirSync(".private", { recursive: true });
    fs.writeFileSync(".private/invoice-ledger-storage-measurement.json", JSON.stringify(storageMeasurement, null, 2));
    console.log("PASS: measured local storage and reusable heap bytes: " + JSON.stringify(storageMeasurement));
    file(db, "tests/database/audit-security.sql");
    const sale = "set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false); begin; select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='syrup'),'unit_key','base','quantity',1)),'cash',150,0,gen_random_uuid()); select pg_sleep(0.4); commit;";
    const results = await Promise.all([parallelSql(db, sale), parallelSql(db, sale)]);
    assert.equal(results.filter((r) => r.code === 0).length, 1, JSON.stringify(results));
    assert.equal(results.filter((r) => r.code !== 0 && r.error.includes("Only ")).length, 1, JSON.stringify(results));
    assert.equal(sql(db, "select sum(quantity_on_hand) from medicine_batches where medicine_id=(select id from test_ids where label='syrup')").trim(), "0.000");
    console.log("PASS: two simultaneous checkouts cannot oversell the final bottle");
    const medicine = sql(db, "select id from test_ids where label='medicine'").trim();
    const request = "aaaaaaaa-0000-0000-0000-000000000099";
    const retry = "set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false); select * from public.checkout_sale('[{\"medicine_id\":\"" + medicine + "\",\"unit_key\":\"base\",\"quantity\":1}]','cash',7,0,'" + request + "');";
    const retries = await Promise.all([parallelSql(db,retry),parallelSql(db,retry)]);
    assert.ok(retries.every((r) => r.code === 0),JSON.stringify(retries));
    assert.equal(sql(db,"select count(*) from sales where idempotency_key='" + request + "'").trim(),"1");
    console.log("PASS: simultaneous identical retries create one invoice");
    for (const sameKey of [true, false]) {
      const refundSale = sql(db, "set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false); select sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id','" + medicine + "'::uuid,'unit_key','base','quantity',2)),'cash',14,0,gen_random_uuid());").trim().split(/\r?\n/).at(-1);
      const refundLine = sql(db, "select id from public.sale_items where sale_id='" + refundSale + "'").trim();
      const returnKey = sameKey ? "a9999999-0000-4000-8000-000000000001" : null;
      const refundRequest = (key) => "set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false); select public.complete_sale_return('" + refundSale + "',jsonb_build_array(jsonb_build_object('sale_item_id','" + refundLine + "'::uuid,'quantity',2,'restockable',true)),'Concurrent returned tablets','" + key + "');";
      const completed = await Promise.all([parallelSql(db, refundRequest(returnKey ?? "a9999999-0000-4000-8000-000000000002")), parallelSql(db, refundRequest(returnKey ?? "a9999999-0000-4000-8000-000000000003"))]);
      assert.equal(completed.filter((result) => result.code === 0).length, sameKey ? 2 : 1, JSON.stringify(completed));
      assert.equal(sql(db, "select count(*) from public.payments where sale_id='" + refundSale + "' and kind='refund'").trim(), "1");
      assert.equal(sql(db, "select sum(refund_amount) from public.sale_returns where sale_id='" + refundSale + "' and status='approved'").trim(), "14.00");
      console.log("PASS: simultaneous " + (sameKey ? "same-key refund retries return one refund" : "distinct-key returns cannot over-refund"));
    }
    const owner = "set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);";
    const batch = sql(db, "select id from public.medicine_batches where medicine_id='" + medicine + "' order by quantity_on_hand desc limit 1").trim();
    for (const sameKey of [true, false]) {
      const balance = Number(sql(db, "select quantity_on_hand from public.medicine_batches where id='" + batch + "'").trim());
      const keys = sameKey ? ["d9999999-0000-4000-8000-000000000001", "d9999999-0000-4000-8000-000000000001"] : ["d9999999-0000-4000-8000-000000000002", "d9999999-0000-4000-8000-000000000003"];
      const removed = await Promise.all(keys.map(key => parallelSql(db, owner + "select public.dispose_stock('" + key + "','" + batch + "','discard',1," + balance + ",'Concurrent local disposal');")));
      assert.equal(removed.filter(result => result.code === 0).length, sameKey ? 2 : 1, JSON.stringify(removed));
      assert.equal(Number(sql(db, "select quantity_on_hand from public.medicine_batches where id='" + batch + "'").trim()), balance - 1);
      assert.equal(sql(db, "select count(*) from public.stock_movements where reference_type='stock_disposition' and reference_id in ('" + keys.join("','") + "')").trim(), "1");
      console.log("PASS: concurrent " + (sameKey ? "disposal retries deduct once" : "different disposal keys cannot reuse a stale balance"));
    }
    const supplier = sql(db, owner + "insert into public.suppliers(name,created_by) values('Concurrent local supplier',auth.uid()) returning id;").trim().split(/\r?\n/).at(-1);
    // Remove once, then race both retry and distinct settlement keys against the same claim.
    for (const sameKey of [true, false]) {
      const balance = Number(sql(db, "select quantity_on_hand from public.medicine_batches where id='" + batch + "'").trim());
      const originalSupplier = sql(db, "select coalesce(b.supplier_id,p.supplier_id,'" + supplier + "'::uuid) from public.medicine_batches b left join public.purchase_items pi on pi.id=b.purchase_item_id left join public.purchases p on p.id=pi.purchase_id where b.id='" + batch + "'").trim();
      const claim = sql(db, owner + "select public.dispose_stock(gen_random_uuid(),'" + batch + "','supplier_return',1," + balance + ",'Concurrent supplier return','" + originalSupplier + "')->>'id';").trim().split(/\r?\n/).at(-1);
      const keys = sameKey ? ["e9999999-0000-4000-8000-000000000001", "e9999999-0000-4000-8000-000000000001"] : ["e9999999-0000-4000-8000-000000000002", "e9999999-0000-4000-8000-000000000003"];
      const settled = await Promise.all(keys.map(key => parallelSql(db, owner + "select public.confirm_supplier_recovery('" + key + "','" + claim + "','refund',1,'Local supplier receipt');")));
      assert.equal(settled.filter(result => result.code === 0).length, sameKey ? 2 : 1, JSON.stringify(settled));
      assert.equal(sql(db, "select count(*) from public.audit_logs where entity_type='stock_dispositions' and entity_id='" + claim + "' and action='confirm_supplier_recovery'").trim(), "1");
      assert.equal(Number(sql(db, "select quantity_on_hand from public.medicine_batches where id='" + batch + "'").trim()), balance - 1);
      console.log("PASS: concurrent " + (sameKey ? "settlement retries confirm once" : "different settlement keys cannot duplicate recoveries"));
    }
  }
  console.log("All local PostgreSQL migration, stock, financial and permission contracts passed.");
} finally {
  for (const db of databases) run("dropdb", [...base, "--force", db]);
  if (started) run("pg_ctl", ["-D", data, "stop", "-m", "fast"]);
}
