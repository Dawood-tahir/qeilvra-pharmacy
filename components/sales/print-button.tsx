"use client";

import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ autoPrint = false, saleId }: { autoPrint?: boolean; saleId: string }) {
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    if (!autoPrint) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      await document.fonts?.ready;
      if (cancelled || attempted.current === saleId) return;
      attempted.current = saleId;
      // Claim before printing: refreshes, navigation, retries and Strict Mode cannot auto-print twice.
      try {
        const key = "qeilvra-printed-" + saleId;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch { return; } // Manual printing remains available when storage is blocked.
      window.print();
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [autoPrint, saleId]);
  return <Button onClick={() => {
    attempted.current = saleId;
    try { sessionStorage.setItem("qeilvra-printed-" + saleId, "1"); } catch {}
    window.print();
  }}><Printer /> Print invoice</Button>;
}
