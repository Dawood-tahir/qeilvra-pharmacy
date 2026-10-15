const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    publishableKey &&
    !supabaseUrl.includes("your-project") &&
    !publishableKey.includes("replace_me"),
);

export function getPublicSupabaseEnv() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and add your project values.",
    );
  }
  return { url: supabaseUrl!, publishableKey: publishableKey! };
}
