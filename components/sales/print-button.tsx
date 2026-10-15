"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => { if (autoPrint) { const timer = setTimeout(() => window.print(), 350); return () => clearTimeout(timer); } }, [autoPrint]);
  return <Button onClick={() => window.print()}><Printer /> Print invoice</Button>;
}
