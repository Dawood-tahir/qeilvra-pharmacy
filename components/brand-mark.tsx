import { Cross } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("grid size-10 place-items-center rounded-xl", light ? "bg-white/12 text-white" : "bg-blue-600 text-white")}>
        <Cross className="size-6" strokeWidth={2.4} />
      </span>
      {!compact && (
        <span>
          <span className={cn("block text-xl font-extrabold tracking-tight", light ? "text-white" : "text-slate-950")}>Qeilvra</span>
          <span className={cn("block text-[11px]", light ? "text-blue-100" : "text-slate-500")}>Pharmacy Management System</span>
        </span>
      )}
    </div>
  );
}
