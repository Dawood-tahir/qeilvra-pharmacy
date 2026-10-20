import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, surface = "secondary", ...props }: React.HTMLAttributes<HTMLDivElement> & { surface?: "primary" | "secondary" | "solid" }) {
  return <div className={cn("q-card rounded-2xl border", `q-glass-${surface}`, className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("q-card-header flex flex-col gap-1.5 p-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("q-card-title text-base font-bold text-slate-950", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("q-card-content p-5 pt-0", className)} {...props} />;
}
