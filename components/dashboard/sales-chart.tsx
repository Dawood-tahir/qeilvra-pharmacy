"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/utils";

export type TrendPoint = { sale_date: string; revenue: number; gross_profit: number; sale_count: number };

export function SalesChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-72 w-full" aria-label="Revenue and gross profit trend chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
            <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="sale_date" tickFormatter={(value) => new Intl.DateTimeFormat("en-PK", { weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))} axisLine={false} tickLine={false} fontSize={12} stroke="#64748b" />
          <YAxis tickFormatter={(value) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} axisLine={false} tickLine={false} width={45} fontSize={12} stroke="#64748b" />
          <Tooltip formatter={(value, name) => [formatCurrency(Number(value)), name === "revenue" ? "Net revenue" : "Gross profit"]} labelFormatter={(label) => new Intl.DateTimeFormat("en-PK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${label}T00:00:00Z`))} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 10px 30px rgba(15,23,42,.1)" }} />
          <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2.5} fill="url(#revenueFill)" />
          <Area type="monotone" dataKey="gross_profit" stroke="#10b981" strokeWidth={2.5} fill="url(#profitFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
