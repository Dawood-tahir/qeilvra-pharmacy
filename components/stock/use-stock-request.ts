"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";

type Outcome = { ok: true } | { ok: false; error: string; uncertain?: boolean };
export function useStockRequest<T>(storageKey: string, schema: z.ZodType<T>, action: (input: T) => Promise<Outcome>, message: string) {
  const router = useRouter();
  const [request, setRequest] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false);
  function restore() {
    try { const raw = sessionStorage.getItem(storageKey); const saved = raw ? schema.parse(JSON.parse(raw)) : null; setRequest(saved); setError(saved ? "An unconfirmed action was restored. Retry to check its status." : ""); return saved; }
    catch { setBlocked(true); setError("An unfinished action could not be read. Check stock history before continuing."); return null; }
  }
  async function execute(input: unknown) {
    if (busy.current || blocked) return false;
    const parsed = schema.safeParse(request ?? input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the details."); return false; }
    const payload = parsed.data;
    try { const raw = JSON.stringify(payload); sessionStorage.setItem(storageKey, raw); if (sessionStorage.getItem(storageKey) !== raw) throw new Error(); }
    catch { setError("Enable browser storage to safely retry this action."); return false; }
    busy.current = true; setPending(true); setRequest(payload); setError("");
    try {
      const result = await action(payload);
      if (!result.ok) { setError(result.error); if (!result.uncertain) { setRequest(null); sessionStorage.removeItem(storageKey); } return false; }
      try { sessionStorage.removeItem(storageKey); } catch { /* Retained keys remain safe to retry. */ }
      setRequest(null); toast.success(message); router.refresh(); return true;
    } catch { setError("The action could not be confirmed. Retry this same action to check its status."); return false; }
    finally { busy.current = false; setPending(false); }
  }
  return { request, error, pending, blocked, restore, execute };
}
