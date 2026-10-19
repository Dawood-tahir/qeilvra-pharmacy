"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReturnLookup } from "@/components/pos/return-lookup";

export function ReturnRequest({ saleId, staffId }: { saleId: string; staffId: string }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="outline" onClick={() => setOpen(true)}><RotateCcw />Return / Refund</Button>{open && <ReturnLookup staffId={staffId} initialSaleId={saleId} onClose={() => setOpen(false)} />}</>;
}
