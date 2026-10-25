// Decrypts the snapshot in memory and restores record shapes/constraints into a
// disposable LOCAL PostgreSQL database. Never connects to hosted Supabase.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createDecipheriv } from "node:crypto";

const directory = path.resolve(process.argv[2] ?? "");
assert.ok(directory.startsWith(path.resolve(".private/cleanup-review") + path.sep), "Provide a cleanup-review backup directory.");
const metadataPath = path.join(directory, "backup.json");
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encrypted = fs.readFileSync(path.join(directory, "records.aes-gcm"));
assert.equal(hash(encrypted), metadata.encryptedSha256);
const unprotect = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))"],
{ input: fs.readFileSync(path.join(directory, "key.dpapi")).toString("base64"), encoding: "utf8", windowsHide: true, timeout: 30_000 });
assert.equal(unprotect.status, 0, "Cannot decrypt backup under this Windows account.");
const key = Buffer.from(unprotect.stdout.trim(), "base64");
const decipher = createDecipheriv(metadata.algorithm, key, Buffer.from(metadata.nonce, "base64"));
decipher.setAuthTag(Buffer.from(metadata.tag, "base64"));
const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
assert.equal(hash(plaintext), metadata.plaintextSha256);
key.fill(0);
const { snapshot } = JSON.parse(plaintext.toString("utf8"));
assert.equal(snapshot.project_ref, metadata.projectRef);
assert.ok(snapshot.enums, "Snapshot needs enum metadata; rerun read-only inspection.");
const bin = "C:/Program Files/PostgreSQL/18/bin";
const data = path.resolve(".local-test-db");
const base = ["-h", "127.0.0.1", "-p", "55439", "-U", "postgres"];
const db = "qeilvra_cleanup_restore_" + process.pid + "_" + Date.now();
assert.match(db, /^qeilvra_cleanup_restore_\d+_\d+$/);
const ident = value => '"' + value.replaceAll('"', '""') + '"';
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const fq = (schema, name) => ident(schema) + "." + ident(name);
const run = (name, args, input) => spawnSync(path.join(bin, name + ".exe"), args,
  { input, encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024, timeout: 120_000 });
const sql = (database, input) => {
  const result = run("psql", [...base, "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-d", database], input);
  if (result.status !== 0) {
    // Avoid logging potentially secret row values from PostgreSQL errors.
    throw new Error("Local restoration statement failed. SQLSTATE/error class: " + (result.stderr.match(/(?:ERROR|FATAL):[^\r\n]*/)?.[0]?.replace(/DETAIL:.*/, "") ?? "process failure"));
  }
  return result.stdout.trim();
};
let started = false, created = false, passed = false, restoredRows = 0;
try {
  if (run("pg_ctl", ["-D", data, "status"]).status !== 0) {
    assert.ok(fs.existsSync(path.join(data, "PG_VERSION")), "Existing isolated local cluster not found.");
    const start = run("pg_ctl", ["-D", data, "-l", path.resolve(".local-test-db.log"), "-o", "-p 55439 -h 127.0.0.1", "start"]);
    assert.equal(start.status, 0, "Local database did not start.");
    started = true;
  }
  assert.equal(path.resolve(sql("postgres", "show data_directory" )).toLowerCase(), data.toLowerCase(), "Unexpected local PostgreSQL data directory; stopping.");
  assert.equal(run("createdb", [...base, db]).status, 0, "Disposable database creation failed.");
  created = true;
  const commands = ["begin; set local timezone='UTC';"];
  for (const schema of new Set(snapshot.tables.map(t => t.schema))) commands.push(`create schema if not exists ${ident(schema)};`);
  for (const type of snapshot.enums) commands.push(`create type ${fq(type.schema, type.name)} as enum (${type.labels.map(quote).join(",")});`);
  for (const table of snapshot.tables) {
    const columns = snapshot.columns.filter(c => c.schema === table.schema && c.table === table.name);
    commands.push(`create table ${fq(table.schema, table.name)} (${columns.map(c => `${ident(c.name)} ${c.type}${c.generated ? ` generated always as (${c.default}) stored` : ""}${c.nullable ? "" : " not null"}`).join(",")});`);
  }
  for (const table of snapshot.tables) {
    const name = table.schema + "." + table.name, relation = fq(table.schema, table.name);
    const columns = snapshot.columns.filter(c => c.schema === table.schema && c.table === table.name && !c.generated).map(c => ident(c.name));
    for (const row of snapshot.records[name]) {
      commands.push(`insert into ${relation} (${columns.join(",")}) select ${columns.join(",")} from jsonb_populate_record(null::${relation},${quote(row)}::jsonb);`);
      restoredRows++;
    }
  }
  // Rebuild and validate every captured PK, unique, check and FK constraint after
  // loading, so a complete dependency graph is checked without disabling anything.
  const relations = new Set(snapshot.tables.map(t => t.schema === "public" ? t.name : t.schema + "." + t.name));
  const constraints = snapshot.constraints.filter(c => relations.has(c.table));
  for (const constraint of constraints.filter(c => c.type !== "f")) commands.push(`alter table ${constraint.table} add constraint ${ident(constraint.name)} ${constraint.definition};`);
  for (const constraint of constraints.filter(c => c.type === "f")) commands.push(`alter table ${constraint.table} add constraint ${ident(constraint.name)} ${constraint.definition};`);
  commands.push("commit;");
  sql(db, commands.join("\n"));
  const unions = snapshot.tables.map(t => `select ${quote(t.schema + "." + t.name)} name,coalesce(jsonb_agg(to_jsonb(r)::text),'[]'::jsonb) records from ${fq(t.schema, t.name)} r`).join(" union all ");
  const restored = JSON.parse(sql(db, `set timezone='UTC'; select jsonb_object_agg(name,records) from (${unions}) t;`));
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(snapshot.records).sort());
  for (const name of Object.keys(snapshot.records)) assert.deepEqual(restored[name].sort(), snapshot.records[name].toSorted(), "Restored rows differ: " + name);
  passed = true;
} finally {
  if (created) assert.equal(run("dropdb", [...base, "--force", db]).status, 0, "Disposable restoration database must be removed manually.");
  if (started) assert.equal(run("pg_ctl", ["-D", data, "stop", "-m", "fast"]).status, 0, "Local database did not stop.");
}
assert.ok(passed);
metadata.restoreDrillVerified = true;
metadata.restoreDrill = { tables: snapshot.tables.length, rows: restoredRows,
  constraints: snapshot.constraints.length, exactRowComparison: true, disposableDatabaseRemoved: true,
  scope: "Record types, generated values, nullability, PK/unique/check/FK constraints. Does not emulate hosted Auth service, triggers, RLS or deployment configuration." };
fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ restoredTables: snapshot.tables.length, restoredRows, exactRowComparison: true,
  constraintsValidated: snapshot.constraints.length, disposableDatabaseRemoved: true, hostedWrites: 0 }, null, 2));
