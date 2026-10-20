import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center px-5 py-6 text-center">
      <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-blue-700"><Icon className="size-6" /></div>
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}
