import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accounts = [
  { fullName: "Qeilvra Owner", email: "owner@qeilvra.test", role: "owner" },
  { fullName: "Qeilvra Staff", email: "staff@qeilvra.test", role: "salesperson" },
].map((account) => ({
  ...account,
  password: `Qv!${randomBytes(18).toString("base64url")}9aA`,
}));

const { data: roles, error: rolesError } = await admin
  .from("user_roles")
  .select("user_id, role");
if (rolesError) throw rolesError;
if (roles.some(({ role }) => role === "owner")) {
  throw new Error("An Owner already exists; initial-user seeding is intentionally one-time only.");
}

const { data: authUsers, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) throw listError;
const requestedEmails = new Set(accounts.map(({ email }) => email));
if (authUsers.users.some(({ email }) => email && requestedEmails.has(email))) {
  throw new Error("One of the initial login emails already exists; no users were created.");
}

const created = [];
try {
  for (const account of accounts) {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });
    if (error || !data.user) throw error ?? new Error(`Could not create ${account.role}.`);
    created.push({ ...account, id: data.user.id });
  }

  const { error: profilesError } = await admin.from("profiles").insert(
    created.map(({ id, fullName }) => ({ id, full_name: fullName })),
  );
  if (profilesError) throw profilesError;

  const { error: insertRolesError } = await admin.from("user_roles").insert(
    created.map(({ id, role }) => ({ user_id: id, role })),
  );
  if (insertRolesError) throw insertRolesError;

  console.log(JSON.stringify({
    created: created.map(({ email, password, role }) => ({ email, password, role })),
  }));
} catch (error) {
  await Promise.allSettled(created.map(({ id }) => admin.auth.admin.deleteUser(id)));
  throw error;
}
