import { z } from "zod";

export const completeReturnSchema = z.object({
  saleId: z.uuid(), idempotencyKey: z.uuid(), reason: z.string().trim().min(3).max(500),
  paymentMethod: z.enum(["cash", "card"]), cardConfirmed: z.boolean().default(false),
  items: z.array(z.object({ sale_item_id: z.uuid(), quantity: z.number().int().positive().max(999999999), restockable: z.boolean(), in_base_units: z.boolean().optional() })).min(1).max(100),
}).refine((value) => value.paymentMethod !== "card" || value.cardConfirmed, { message: "Confirm the manual card refund." })
  .refine((value) => new Set(value.items.map((item) => item.sale_item_id)).size === value.items.length, { message: "Each medicine line can be returned only once." });
export type CompleteReturnInput = z.infer<typeof completeReturnSchema>;
export const returnSaleSchema = z.object({
  id: z.uuid(), invoice_number: z.string(), completed_at: z.string(), cashier: z.string(),
  subtotal: z.coerce.number(), net_total: z.coerce.number(),
  sale_items: z.array(z.object({ id: z.uuid(), medicine_name: z.string(), quantity: z.coerce.number(), unit_label: z.string(), unit_price: z.coerce.number(), net_line_total: z.coerce.number(), approved: z.coerce.number(), available: z.coerce.number(), base_units_per_sale_unit: z.coerce.number().int().positive().default(1), base_unit: z.string().default("unit"), approved_base_quantity: z.coerce.number().optional(), available_base_quantity: z.coerce.number().optional() })),
});
export type ReturnSale = z.infer<typeof returnSaleSchema>;
export const pendingReturnSchema = z.object({ input: completeReturnSchema, invoice: returnSaleSchema });
export const returnStorageKey = (staffId: string) => "qeilvra-return-v1-" + staffId;
