"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProfileRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lastRefresh = useRef(0);
  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      // Focus and visibilitychange often arrive together. Read current stock once.
      if (document.visibilityState === "visible" && now - lastRefresh.current > 1000) { lastRefresh.current = now; router.refresh(); }
    };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw className={pending ? "animate-spin" : ""} />{pending ? "Refreshing..." : "Refresh"}</Button>;
}
