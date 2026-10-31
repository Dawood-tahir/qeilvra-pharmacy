import { z } from "zod";

export const supplierInformationFields = ["name", "contact_person", "phone", "email", "address", "city", "tax_number"] as const;
export type SupplierInformationField = typeof supplierInformationFields[number];
export type SupplierInformationValues = Record<SupplierInformationField, string>;
export type SupplierInformationErrors = Partial<Record<SupplierInformationField, string>>;

const optionalText = (maximum: number, label: string) => z.string().trim().max(maximum, `${label} must be ${maximum} characters or fewer.`).transform(value => value || null);

// Keep formatting, country codes and extensions; never coerce phone numbers to numbers.
const phone = z.string().trim().max(40, "Phone number must be 40 characters or fewer.").refine(value => {
  if (!value) return true;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 21 && /^\+?[\d\s()./-]+(?:\s*(?:ext\.?|x|#)\s*\d+)?$/i.test(value);
}, "Enter a valid local or international phone number, such as 03001234567 or +923001234567.").transform(value => value || null);

export const supplierInformationSchema = z.object({
  name: z.string().trim().min(2, "Supplier / Company Name must contain at least 2 characters.").max(160, "Supplier / Company Name must be 160 characters or fewer."),
  contact_person: optionalText(120, "Contact person name"),
  phone,
  email: z.string().trim().max(254, "Email address must be 254 characters or fewer.").refine(value => !value || z.email().safeParse(value).success, "Enter a complete email address, such as orders@example.com, or leave it blank.").transform(value => value || null),
  address: optionalText(500, "Business address"),
  city: optionalText(120, "City"),
  tax_number: optionalText(80, "Tax registration number"),
});

export function supplierInformationErrors(error: z.ZodError): SupplierInformationErrors {
  const errors: SupplierInformationErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as SupplierInformationField;
    if (supplierInformationFields.includes(field) && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

export type SupplierUpdateResult = { ok: true } | { ok: false; error: string; fieldErrors?: SupplierInformationErrors };
