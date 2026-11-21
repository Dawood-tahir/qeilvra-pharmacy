"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LivePagination({ page, lastPage, onChange }: { page: number; lastPage: number; onChange: (page: number) => void }) {
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500" role="status">Page {page}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft /> Previous</Button>
        <Button type="button" variant="outline" size="sm" disabled={page === lastPage} onClick={() => onChange(page + 1)}>Next <ChevronRight /></Button>
      </div>
    </nav>
  );
}
