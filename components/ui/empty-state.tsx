import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
      <div className="mb-3 rounded-2xl bg-slate-100 p-3 text-slate-500"><Icon className="size-6" /></div>
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}
