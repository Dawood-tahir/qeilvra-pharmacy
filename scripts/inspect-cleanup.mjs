// Read-only preparation. This script has no deletion, account creation, migration,
// archive-worker, deployment, or configuration-update path.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const projectRef = fs.readFileSync("supabase/.temp/project-ref", "utf8").trim();
const configuredRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
assert.equal(projectRef, configuredRef, "Linked and configured project identities differ.");
assert.match(projectRef, /^[a-z]{20}$/);
assert.equal(process.platform, "win32", "Backup key protection requires Windows DPAPI.");
const cli = path.resolve("node_modules/supabase/dist/supabase.js");
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const ident = value => '"' + value.replaceAll('"', '""') + '"';
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const out = path.resolve(".private/cleanup-review", new Date().toISOString().replaceAll(":", "-"));
fs.mkdirSync(out, { recursive: true });

function query(sql) {
  const file = path.join(out, "inspection.sql");
  fs.writeFileSync(file, "begin isolation level repeatable read read only; set local statement_timeout='60s';\n" + sql + ";\nrollback;\n");
  const result = spawnSync(process.execPath, [cli, "db", "query", "--linked", "--file", file, "--output", "json"], {
    encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(result.status, 0, "Read-only database query failed; no response data logged.");
  const start = result.stdout.indexOf("{");
  assert.ok(start >= 0, "Supabase CLI did not return JSON.");
  const response = JSON.parse(result.stdout.slice(start));
  assert.ok(Array.isArray(response.rows));
  return response.rows;
}

function protectKey(bytes, decrypt = false) {
  const operation = decrypt ? "Unprotect" : "Protect";
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[System.Security.Cryptography.ProtectedData]::${operation}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: bytes.toString("base64"), encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  assert.equal(result.status, 0, "Windows backup-key protection failed.");
  return Buffer.from(result.stdout.trim(), "base64");
}

const tables = query("select schemaname,tablename from pg_tables where schemaname in ('public','private','auth','storage','supabase_migrations') order by schemaname,tablename");
const tableSql = tables.map(({ schemaname, tablename }) => {
  const name = schemaname + "." + tablename;
  return `select ${quote(name)} name,coalesce(jsonb_agg(to_jsonb(t)::text order by to_jsonb(t)::text),'[]'::jsonb) records from ${ident(schemaname)}.${ident(tablename)} t`;
}).join(" union all ");
const [{ snapshot }] = query(`select jsonb_build_object(
 'project_ref',${quote(projectRef)},'captured_at',now(),'database',current_database(),
 'records',(select jsonb_object_agg(name,records) from (${tableSql}) t),
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth','storage','supabase_migrations') and c.relkind in ('r','p')),
 'columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,'identity',a.attidentity,'nullable',not a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname in ('public','private','auth','storage','supabase_migrations') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped),
 'enums',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'labels',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid))) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='e' and n.nspname in ('public','private','auth','storage')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'referenced_table',case when c.confrelid<>0 then c.confrelid::regclass::text end,'type',c.contype,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private','auth','storage') or c.confrelid in (select cl.oid from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname in ('public','private','auth','storage'))),
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'acl',p.proacl)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
 'triggers',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth','storage') and not t.tgisinternal),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in ('public','private','auth','storage')),
 'views',(select jsonb_agg(to_jsonb(v)) from pg_views v where schemaname in ('public','private')),
 'sequences',(select jsonb_agg(to_jsonb(s)) from pg_sequences s where schemaname in ('public','private','auth','storage')),
 'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion)) from pg_extension),
 'archive_settings_exists',to_regclass('private.invoice_archive_settings') is not null,
 'retained_ledger_exists',to_regclass('private.invoice_item_ledger') is not null,
 'cron_exists',to_regclass('cron.job') is not null
) snapshot`);

const payload = Buffer.from(JSON.stringify({ format: "qeilvra-record-snapshot-v1", snapshot }));
const key = randomBytes(32), nonce = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, nonce);
const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
const tag = cipher.getAuthTag(), protectedKey = protectKey(key);
const restoredKey = protectKey(protectedKey, true);
const decipher = createDecipheriv("aes-256-gcm", restoredKey, nonce);
decipher.setAuthTag(tag);
const readable = Buffer.concat([decipher.update(encrypted), decipher.final()]);
assert.deepEqual(readable, payload, "Backup encryption round trip failed.");
const decoded = JSON.parse(readable.toString("utf8"));
assert.equal(decoded.snapshot.project_ref, projectRef);
for (const rows of Object.values(decoded.snapshot.records)) for (const row of rows) JSON.parse(row);
fs.writeFileSync(path.join(out, "records.aes-gcm"), encrypted, { flag: "wx" });
fs.writeFileSync(path.join(out, "key.dpapi"), protectedKey, { flag: "wx" });
const envelope = { format: "qeilvra-record-snapshot-v1", projectRef, capturedAt: snapshot.captured_at,
  algorithm: "aes-256-gcm", nonce: nonce.toString("base64"), tag: tag.toString("base64"),
  plaintextSha256: hash(payload), encryptedSha256: hash(encrypted),
  keyProtection: "Windows DPAPI CurrentUser; requires this Windows account and its DPAPI keys",
  rowEncoding: "Exact PostgreSQL JSON text per row; preserve numeric tokens during restoration",
  readbackVerified: false, restoreDrillVerified: false,
};
fs.writeFileSync(path.join(out, "backup.json"), JSON.stringify(envelope, null, 2));
// Independently reopen all files, decrypt and check the persisted backup bytes.
const disk = JSON.parse(fs.readFileSync(path.join(out, "backup.json"), "utf8"));
const diskCipher = fs.readFileSync(path.join(out, "records.aes-gcm"));
assert.equal(hash(diskCipher), disk.encryptedSha256);
const diskDecipher = createDecipheriv(disk.algorithm, protectKey(fs.readFileSync(path.join(out, "key.dpapi")), true), Buffer.from(disk.nonce, "base64"));
diskDecipher.setAuthTag(Buffer.from(disk.tag, "base64"));
const diskPlain = Buffer.concat([diskDecipher.update(diskCipher), diskDecipher.final()]);
assert.equal(hash(diskPlain), disk.plaintextSha256);
assert.deepEqual(diskPlain, payload);
envelope.readbackVerified = true;
fs.writeFileSync(path.join(out, "backup.json"), JSON.stringify(envelope, null, 2));
key.fill(0); restoredKey.fill(0);

const rows = name => (snapshot.records[name] ?? []).map(row => JSON.parse(row));
const users = rows("auth.users").map(u => ({ id: u.id, email: u.email, created_at: u.created_at,
  last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at,
  roles: rows("public.user_roles").filter(r => r.user_id === u.id).map(r => r.role),
  profile: rows("public.profiles").find(p => p.id === u.id) ?? null,
  classification: /@qeilvra\.test$/.test(u.email) ? "seeded test candidate; approval still required" : "unclassified; preserve pending user review",
}));
const review = {
  projectRef, capturedAt: snapshot.captured_at, deletionApproved: false, recordsDeleted: 0,
  counts: Object.fromEntries(Object.entries(snapshot.records).map(([name, records]) => [name, records.length])),
  users,
  businessReview: Object.fromEntries(["medicines", "suppliers", "purchases", "sales", "expenses", "stock_dispositions"].map(name => [name, rows("public." + name)])),
  archive: { settingsInstalled: snapshot.archive_settings_exists, ledgerInstalled: snapshot.retained_ledger_exists,
    databaseCronInstalled: snapshot.cron_exists, storageBuckets: rows("storage.buckets"), storageObjectCount: rows("storage.objects").length },
  catalogCounts: Object.fromEntries(["tables", "constraints", "functions", "triggers", "policies", "views", "sequences"].map(name => [name, snapshot[name]?.length ?? 0])),
  backup: envelope,
};
fs.writeFileSync(path.join(out, "review.json"), JSON.stringify(review, null, 2));
fs.writeFileSync(path.join(out, "catalog.json"), JSON.stringify(Object.fromEntries(["tables", "columns", "enums", "constraints", "functions", "triggers", "policies", "views", "sequences", "extensions"].map(name => [name, snapshot[name]])), null, 2));
console.log(JSON.stringify({ directory: out, projectRef, capturedAt: snapshot.captured_at,
  publicCounts: Object.fromEntries(Object.entries(review.counts).filter(([name]) => name.startsWith("public."))),
  authUsers: users.map(({ id, email, roles, classification }) => ({ id, email, roles, classification })),
  archive: review.archive, catalogCounts: review.catalogCounts, backupReadbackVerified: true,
  restoreDrillVerified: false, recordsDeleted: 0 }, null, 2));
