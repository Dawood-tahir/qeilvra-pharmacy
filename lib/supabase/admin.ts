import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@/lib/env";

export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not configured.");
  const { url } = getPublicSupabaseEnv();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
