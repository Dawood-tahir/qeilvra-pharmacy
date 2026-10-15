import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY before bootstrapping.");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: existing, error: existingError } = await admin.from("user_roles").select("user_id").eq("role", "owner").limit(1);
if (existingError) throw existingError;
if (existing?.length) {
  console.error("An Owner already exists. Bootstrap is intentionally one-time only.");
  process.exit(1);
}

const prompt = createInterface({ input, output });
const fullName = (await prompt.question("Owner full name: ")).trim();
const email = (await prompt.question("Owner email: ")).trim();
const password = await prompt.question("Temporary password (10+ characters): ");
prompt.close();
if (fullName.length < 2 || !email.includes("@") || password.length < 10) {
  console.error("Enter a valid name, email, and password of at least 10 characters.");
  process.exit(1);
}

const { data: authData, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
if (authError || !authData.user) throw authError ?? new Error("User creation failed.");
try {
  const { error: profileError } = await admin.from("profiles").insert({ id: authData.user.id, full_name: fullName });
  if (profileError) throw profileError;
  const { error: roleError } = await admin.from("user_roles").insert({ user_id: authData.user.id, role: "owner" });
  if (roleError) throw roleError;
  console.log(`Owner created for ${email}. Sign in and replace the temporary password.`);
} catch (error) {
  await admin.auth.admin.deleteUser(authData.user.id);
  throw error;
}
