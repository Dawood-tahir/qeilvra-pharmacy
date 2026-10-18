import { z } from "zod";
import { medicineTypes } from "@/lib/medicine-units";
import { localDateISO } from "@/lib/utils";
export const moneyInput = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Use a price with up to two decimal places.");
export const receiveStockSchema = z.object({
  unit_key: z.enum(["base", "strip", "box"]), quantity: z.number().int("Enter a whole quantity.").positive().max(999999999),
  batch_number: z.string().trim().min(1, "Enter the batch number.").max(80),
  expiry_date: z.iso.date().refine((date) => date > localDateISO(), "Choose a future expiry date."),
  total_cost: moneyInput, supplier_id: z.union([z.uuid(), z.literal("")]).optional(),
});
export const guidedMedicineSchema = z.object({
  name: z.string().trim().min(2, "Enter the medicine name.").max(160), dosage_form: z.enum(medicineTypes),
  strength: z.string().trim().max(80), barcode: z.string().trim().max(80), manufacturer: z.string().trim().max(160),
  generic_name: z.string().trim().max(160).default(""), sku: z.string().trim().max(80).optional(),
  reorder_level: z.number().int().nonnegative().max(999999999).default(10),
  tablets_per_strip: z.number().int().positive().max(999999999).nullable(), strips_per_box: z.number().int().positive().max(999999999).nullable(),
  confirm_existing: z.boolean().default(false), is_active: z.boolean().default(true),
  units: z.array(z.object({ unit_key: z.enum(["base", "strip", "box"]), selling_price: moneyInput.refine((p) => Number(p) > 0, "Enter a selling price greater than zero."), max_price: moneyInput.nullable() })).min(1).max(3),
}).superRefine((data, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message, path: ["units"] });
  if (!["Tablet", "Capsule"].includes(data.dosage_form) && (data.tablets_per_strip || data.strips_per_box || data.units.some((u) => u.unit_key !== "base"))) fail("Sell this medicine as a whole sealed item.");
  if (data.strips_per_box && !data.tablets_per_strip) fail("Enter tablets in one strip first.");
  if ((data.tablets_per_strip ?? 1) * (data.strips_per_box ?? 1) > 999999999) fail("The pack size is too large.");
  const keys = data.units.map((u) => u.unit_key);
  if (!keys.includes("base") || new Set(keys).size !== keys.length) fail("Check the selling units.");
  for (const unit of data.units) {
    if ((unit.unit_key === "strip" && !data.tablets_per_strip) || (unit.unit_key === "box" && !data.strips_per_box)) fail("Confirm the packaging for this price.");
    if (unit.max_price && Number(unit.selling_price) > Number(unit.max_price)) fail("The selling price exceeds its permitted limit.");
  }
});
