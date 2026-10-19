"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { validSalePrice } from "@/lib/sale-pricing";
import type { SellingUnit } from "@/lib/medicine-units";

export function PriceEditor({ name, unit, price, role, onSave, onClose }: { name: string; unit: SellingUnit; price: number; role: string; onSave: (value: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(price.toFixed(2));
  const valid = validSalePrice(value) && (unit.max_price == null || Number(value) <= Number(unit.max_price));
  return <Dialog label="Edit Price" onClose={onClose}>
    <h2 className="text-xl font-extrabold">Edit Price</h2><p className="mt-3 text-sm font-bold">{name}</p><p className="text-xs text-slate-500">{unit.label} · Catalogue price: {formatCurrency(unit.selling_price)}</p>
    <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (valid) { onSave(Number(value)); onClose(); } }}>
      <label className="text-sm font-semibold">New price (Rs.)<Input autoFocus className="mt-1" inputMode="decimal" value={value} onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)} /></label>
      <p className="mt-2 text-xs text-slate-500">This sale only. {role === "owner" ? "You authorize this price as Owner." : "Custom reductions and invoice discounts share your existing discount limit."}</p>
      {!valid && <p role="alert" className="mt-2 text-sm text-red-700">Enter a positive price with up to two decimals{unit.max_price != null ? ", no higher than " + formatCurrency(unit.max_price) : ""}.</p>}
      <div className="mt-4 flex gap-2"><Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={!valid}>Update Price</Button></div>
    </form>
  </Dialog>;
}
