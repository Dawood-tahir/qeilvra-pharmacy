"use client";

import { lazy, Suspense, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogLoading } from "@/components/ui/dialog-loading";
const ReturnLookup = lazy(() => import("@/components/pos/return-lookup").then(module => ({ default: module.ReturnLookup })));

export function ReturnRequest({ saleId, staffId }: { saleId: string; staffId: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><RotateCcw />Return / Refund</Button>
    {open && <Suspense fallback={<DialogLoading label="Return / Refund" onClose={() => setOpen(false)} />}>
      <ReturnLookup staffId={staffId} initialSaleId={saleId} onClose={() => setOpen(false)} />
    </Suspense>}
  </>;
}
