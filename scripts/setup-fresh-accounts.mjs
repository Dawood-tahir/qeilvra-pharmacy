// Operational account setup only. No business-data cleanup or old-user deletion.
// Run after the user approves the reviewed scope. Invitations preserve Qeilvra's
// existing email-verification and /update-password account-setup flow.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";

const mode = process.argv[2];
if (!["invite", "verify"].includes(mode)) {
  console.log("Usage: node --env-file=.env.local scripts/setup-fresh-accounts.mjs invite|verify");
  console.log("invite: request real account details locally and send verified-setup invitations.");
  console.log("verify: enter each password locally with echo disabled and check role/report access.");
  process.exit(0);
}
assert.ok(stdin.isTTY && stdout.isTTY, "Use an interactive local terminal. Never pipe credentials into this script.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const ref = fs.readFileSync("supabase/.temp/project-ref", "utf8").trim();
assert.equal(new URL(url).hostname, ref + ".supabase.co", "Configured and linked projects differ.");
assert.ok(key && secret, "Use the existing local Supabase environment.");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secret, options);
const question = async text => {
  const prompt = createInterface({ input: stdin, output: stdout });
  try { return (await prompt.question(text)).trim(); } finally { prompt.close(); }
};
const password = () => new Promise((resolve, reject) => {
  let value = "";
  stdout.write("Password (hidden; never saved): ");
  const previousRaw = stdin.isRaw;
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  const finish = () => { stdin.off("data", onData); stdin.setRawMode(previousRaw); stdin.pause(); stdout.write("\n"); };
  const onData = chunk => {
    for (const character of chunk) {
      if (character === "\u0003") { finish(); reject(new Error("Cancelled.")); return; }
      if (character === "\r" || character === "\n") { finish(); resolve(value); value = ""; return; }
      if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
      else if (character >= " " && character !== "\u007f") value += character;
    }
  };
  stdin.on("data", onData);
});

async function verify(role, expectedEmail) {
  const email = expectedEmail ?? await question(`${role} email: `);
  const client = createClient(url, key, options);
  let value = await password();
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password: value });
    value = "";
    assert.ok(!error && data.user && data.session, "Login failed. Check the password and complete email verification first.");
    assert.ok(data.user.email_confirmed_at, "Email verification is incomplete.");
    const profile = await client.from("profiles").select("is_active,user_roles!inner(role)").eq("id", data.user.id).single();
    assert.ok(!profile.error && profile.data?.is_active, "An active application profile is required.");
    const roles = profile.data.user_roles;
    assert.equal(Array.isArray(roles) ? roles[0]?.role : roles?.role, role, "Application role mismatch.");
    const args = role === "owner" ? { p_from: "1900-01-01", p_to: "2100-12-31" } : undefined;
    const report = await client.rpc(role === "owner" ? "owner_dashboard_metrics" : "salesperson_dashboard", args);
    assert.ok(!report.error && report.data, "Dashboard permission/report check failed.");
    if (role === "salesperson") {
      const forbidden = await client.rpc("owner_dashboard_metrics", { p_from: "1900-01-01", p_to: "2100-12-31" });
      assert.equal(forbidden.error?.code, "42501", "Owner report restriction was not enforced.");
    }
    console.log(`${role}: email verified; login, active profile, database role and dashboard RPC passed. User ID: ${data.user.id}`);
    console.log("Application pages and POS browser checks must also pass before removing old accounts.");
  } finally {
    value = "";
    await client.auth.signOut({ scope: "local" });
  }
}

console.log(`Project: ${ref}. Mode: ${mode}. No old accounts will be removed.`);
if (mode === "verify") {
  await verify("owner");
  await verify("salesperson");
} else {
  const accounts = [];
  for (const role of ["owner", "salesperson"]) {
    const fullName = await question(`${role} full name: `);
    const email = await question(`${role} email: `);
    assert.ok(fullName.length >= 2 && fullName.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter a valid name and email.");
    accounts.push({ role, fullName, email });
  }
  assert.notEqual(accounts[0].email.toLowerCase(), accounts[1].email.toLowerCase(), "Use separate account emails.");
  const appUrl = await question(`Existing Qeilvra app URL for setup emails [${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}]: `) || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const parsedUrl = new URL(appUrl);
  assert.ok(parsedUrl.protocol === "https:" || (parsedUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedUrl.hostname)), "Use the existing HTTPS app or local setup server.");
  const redirectTo = new URL("/auth/callback?next=/update-password", parsedUrl).href;
  const emails = new Set(accounts.map(a => a.email.toLowerCase()));
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    assert.ok(!error, "Cannot check existing accounts.");
    assert.ok(data.users.every(u => !emails.has(u.email?.toLowerCase())), "An email already exists; stop and review it without overwriting the account.");
    if (data.users.length < 100) break;
  }
  console.log(accounts.map(a => `${a.role}: ${a.fullName} <${a.email}>`).join("\n"));
  assert.equal(await question(`Type CREATE ACCOUNTS ${ref} to send these two setup invitations: `), `CREATE ACCOUNTS ${ref}`, "Account creation was not confirmed.");
  for (const account of accounts) {
    const result = await admin.auth.admin.inviteUserByEmail(account.email, { redirectTo, data: { full_name: account.fullName } });
    assert.ok(!result.error && result.data.user, "Invitation failed. Stop and inspect account state before retrying.");
    const id = result.data.user.id;
    const profile = await admin.from("profiles").insert({ id, full_name: account.fullName });
    assert.ok(!profile.error, `Profile creation failed for new user ${id}; inspect before continuing.`);
    const role = await admin.from("user_roles").insert({ user_id: id, role: account.role });
    assert.ok(!role.error, `Role assignment failed for new user ${id}; inspect before continuing.`);
    console.log(`Invitation sent for ${account.role}. Complete the email link and set your chosen password through Qeilvra.`);
  }
  console.log("Then run this script with verify to enter passwords locally with echo disabled.");
  console.log("Keep the old Owner until new Owner browser and permission checks pass.");
}
