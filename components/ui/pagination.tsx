import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function Pagination({ pathname, page, hasMore, query = {} }: { pathname: string; page: number; hasMore: boolean; query?: Record<string, string> }) {
  const href = (next: number) => pathname + "?" + new URLSearchParams({ ...query, page: String(next) });
  return <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs text-slate-500">Page {page}</p>
    <div className="flex gap-2">
      {page > 1 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href(page - 1)}><ChevronLeft /> Previous</Link> : <span aria-disabled="true" className={buttonVariants({ variant: "outline", size: "sm", className: "opacity-50" })}><ChevronLeft /> Previous</span>}
      {hasMore ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href(page + 1)}>Next <ChevronRight /></Link> : <span aria-disabled="true" className={buttonVariants({ variant: "outline", size: "sm", className: "opacity-50" })}>Next <ChevronRight /></span>}
    </div>
  </nav>;
}
