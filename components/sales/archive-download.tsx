"use client";
import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ArchiveDownload() {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const response = await fetch("/api/invoices/archive", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error(result.error ?? "Invoice archive could not be downloaded.");
      window.location.assign(result.url);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Invoice archive could not be downloaded."); }
    finally { setBusy(false); }
  }
  return <Button variant="outline" className="h-11 w-full text-blue-700 sm:w-auto" disabled={busy} onClick={download}>{busy ? <LoaderCircle className="animate-spin" /> : <Download />}{busy ? "Preparing archive..." : "Download Invoice Archive"}</Button>;
}
