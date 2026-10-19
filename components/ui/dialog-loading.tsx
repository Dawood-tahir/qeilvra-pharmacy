"use client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function DialogLoading({ label, onClose }: { label: string; onClose: () => void }) {
  return <Dialog label={label} onClose={onClose}><p role="status" className="py-4 text-sm text-slate-600">Opening {label.toLowerCase()}…</p><Button variant="outline" onClick={onClose}>Close</Button></Dialog>;
}
