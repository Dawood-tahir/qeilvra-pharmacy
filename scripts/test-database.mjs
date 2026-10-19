import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
const bin = process.env.PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "");
const exe = (name) => bin ? path.join(bin, name + (process.platform === "win32" ? ".exe" : "")) : name;
const data = path.resolve(".local-test-db");
const port = "55439";
const base = ["-h", "127.0.0.1", "-p", port, "-U", "postgres"];
let started = false;
const databases = [];
const run = (name, args, input) => execFileSync(exe(name), args, { encoding: "utf8", windowsHide: true, input, stdio: ["pipe", "pipe", "pipe"] });
function sql(db, text) { return run("psql", [...base, "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq"], text); }
function file(db, name) {
  try {
    const result = execFileSync(exe("psql"), [...base, "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq", "-f", name], { encoding: "utf8", windowsHide: true });
    return result;
  } catch (e) { throw new Error("Database check failed in " + name + ": " + (e.stderr ?? e.message)); }
}
function parallelSql(db, text) {
  return new Promise((resolve) => {
    const child = spawn(exe("psql"), [...base, "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq"], { windowsHide: true });
    let out = "", error = "";
    child.stdout.on("data", (d) => out += d); child.stderr.on("data", (d) => error += d);
    child.on("close", (code) => resolve({ code, out, error }));
    child.stdin.end(text);
  });
}
try {
  if (!fs.existsSync(path.join(data, "PG_VERSION"))) run("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale", "-E", "UTF8"]);
  try { run("pg_ctl", ["-D", data, "status"]); } catch {
    // A background postgres process can inherit captured pipe handles on Windows
    // and leave execFileSync waiting after pg_ctl has already exited.
    execFileSync(exe("pg_ctl"), ["-D", data, "-l", path.resolve(".local-test-db.log"), "-o", "-p " + port + " -h 127.0.0.1", "start"], { windowsHide: true, stdio: "ignore", timeout: 60000 });
    started = true;
  }
  const migrations = fs.readdirSync("supabase/migrations").sort();
  for (const legacy of [true, false]) {
    const db = "qeilvra_contract_" + process.pid + (legacy ? "_legacy" : "");
    run("createdb", [...base, db]); databases.push(db);
    file(db, "tests/database/bootstrap.sql");
    for (const migration of migrations) {
      if (legacy && migration.startsWith("202610180005")) file(db, "tests/database/legacy-before.sql");
      file(db, "supabase/migrations/" + migration);
    }
    if (legacy) { file(db, "tests/database/legacy-after.sql"); console.log("PASS: legacy quantities, costs and history survive migration"); continue; }
    file(db, "tests/database/contracts.sql");
    file(db, "tests/database/edge-cases.sql");
    file(db, "tests/database/supplier-receiving.sql");
    file(db, "tests/database/pos-custom-prices.sql");
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
  }
  console.log("All local PostgreSQL migration, stock, financial and permission contracts passed.");
} finally {
  for (const db of databases) run("dropdb", [...base, "--force", db]);
  if (started) run("pg_ctl", ["-D", data, "stop", "-m", "fast"]);
}
