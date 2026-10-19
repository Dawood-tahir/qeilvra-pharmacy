"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { TrendPoint } from "@/components/dashboard/sales-chart";
export type { TrendPoint } from "@/components/dashboard/sales-chart";

function Placeholder() { return <div role="status" aria-label="Loading sales chart" className="skeleton h-52 rounded-xl sm:h-72" />; }
const Chart = dynamic(() => import("@/components/dashboard/sales-chart").then(module => module.SalesChart), { ssr: false, loading: Placeholder });

export function LazySalesChart({ data }: { data: TrendPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "100px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="h-52 min-w-0 sm:h-72">{visible ? <Chart data={data} /> : <Placeholder />}</div>;
}
