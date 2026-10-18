"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DateRangeFilter({ from, to }: { from: string; to: string }) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  return <form aria-label="Date range" className="grid grid-cols-2 items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex sm:flex-wrap">
    <label className="min-w-0"><span className="mb-1 block text-sm font-semibold">From</span><Input name="from" type="date" required max={end} value={start} onChange={(event) => setStart(event.target.value)} /></label>
    <label className="min-w-0"><span className="mb-1 block text-sm font-semibold">To</span><Input name="to" type="date" required min={start} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    <Button className="col-span-2" variant="outline">Apply dates</Button>
  </form>;
}
