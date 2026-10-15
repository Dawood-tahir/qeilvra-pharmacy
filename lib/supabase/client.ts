"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (!client) {
    const { url, publishableKey } = getPublicSupabaseEnv();
    client = createBrowserClient(url, publishableKey);
  }
  return client;
}
