import { z } from "zod";
import { decimalCostMinor } from "@/lib/decimal-money";

export const recoveryMethod = z.enum(["credit", "refund", "replacement"]);
export const dispositionSchema = z.object({
  key: z.uuid(), batchId: z.uuid(), kind: z.enum(["discard", "supplier_return"]),
  quantity: z.number().int().positive().max(999999999), expectedQuantity: z.number().nonnegative(),
  reason: z.string().trim().min(3).max(500), supplierId: z.uuid().nullable(), method: recoveryMethod.default("credit"),
  removed: z.literal(true, { error: "Confirm the stock has been removed or segregated." }),
});
export const recoverySchema = z.object({
  key: z.uuid(), dispositionId: z.uuid(), method: recoveryMethod,
  amount: z.number().nonnegative().max(999999999999.99).multipleOf(0.01), reference: z.string().trim().max(120),
  confirmed: z.literal(true, { error: "Confirm the supplier settlement has been received." }),
  replacement: z.object({ batch_number: z.string().trim().min(1).max(80), expiry_date: z.iso.date(), quantity: z.number().int().positive().max(999999999) }).nullable(),
}).refine(value => value.method !== "replacement" || value.replacement !== null, { message: "Enter the replacement batch, expiry and quantity." });
export type DispositionInput = z.infer<typeof dispositionSchema>;
export type RecoveryInput = z.infer<typeof recoverySchema>;
export type StockDisposition = {
  id: string; kind: "discard" | "supplier_return"; medicine_id: string; medicine_name: string; batch_id: string; batch_number: string;
  quantity: number; base_unit: string; unit_cost: number; cost_value: number; reason: string; created_at: string;
  supplier_id: string | null; purchase_id: string | null; recovery_state: "not_applicable" | "pending" | "confirmed";
  recovery_method: "refund" | "credit" | "replacement" | null; recovery_amount: number; confirmed_at: string | null; recovery_reference: string | null;
  replacement_purchase_id: string | null; suppliers?: { name: string } | null; actor?: { full_name: string } | null;
};
export const batchCostMinor = decimalCostMinor;
