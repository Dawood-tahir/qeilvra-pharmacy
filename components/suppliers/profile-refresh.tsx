"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProfileRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lastRefresh = useRef(0);
  const refreshing = useRef(false);
  useEffect(() => { refreshing.current = pending; }, [pending]);
  useEffect(() => {
    lastRefresh.current = Date.now();
    const refresh = () => {
      const now = Date.now();
      // Revalidate on return after a minute, rather than polling every open tab.
      if (document.visibilityState === "visible" && !refreshing.current && now - lastRefresh.current >= 60_000) {
        lastRefresh.current = now;
        refreshing.current = true;
        startTransition(() => router.refresh());
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { lastRefresh.current = Date.now(); refreshing.current = true; startTransition(() => router.refresh()); }}><RefreshCw className={pending ? "animate-spin" : ""} />{pending ? "Refreshing..." : "Refresh"}</Button>;
}
