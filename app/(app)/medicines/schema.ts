import { z } from "zod";

export const medicineSchema = z.object({
  name: z.string().trim().min(2, "Enter the medicine name.").max(160),
  generic_name: z.string().trim().max(160).default(""),
  manufacturer: z.string().trim().max(160).default(""),
  category_id: z.string().default(""),
  strength: z.string().trim().max(80).default(""),
  dosage_form: z.string().trim().max(80).default(""),
  barcode: z.string().trim().max(80).default(""),
  sku: z.string().trim().min(2, "Enter a SKU.").max(80),
  purchase_price: z.coerce.number().min(0, "Purchase price cannot be negative."),
  selling_price: z.coerce.number().min(0, "Selling price cannot be negative."),
  reorder_level: z.coerce.number().min(0),
  base_unit: z.string().trim().min(1).max(32),
  units_per_pack: z.coerce.number().positive(),
  is_active: z.boolean().default(true),
});

export type MedicineFormValues = z.infer<typeof medicineSchema>;
export type MedicineFormInput = z.input<typeof medicineSchema>;
