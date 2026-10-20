import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const variants = cva("q-badge inline-flex max-w-full items-center rounded-lg border border-current/10 px-2 py-1 text-xs font-semibold leading-4", {
  variants: {
    variant: {
      default: "bg-blue-50 text-blue-700",
      success: "bg-emerald-50 text-emerald-700",
      warning: "bg-amber-50 text-amber-700",
      destructive: "bg-red-50 text-red-700",
      neutral: "bg-slate-100 text-slate-600",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof variants>) {
  return <span className={cn(variants({ variant }), className)} {...props} />;
}
