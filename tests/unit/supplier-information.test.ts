import { describe, expect, it } from "vitest";
import { supplierInformationSchema } from "@/lib/supplier-information";

const values = { name: "City Pharmacy", contact_person: "", phone: "", email: "", address: "", city: "", tax_number: "" };
describe("supplier business information validation", () => {
  it("trims names, keeps multiline addresses and tax formatting, and clears empty optional fields", () => {
    expect(supplierInformationSchema.parse({ ...values, name: "  City Pharmacy  ", address: "12 Main Road\nFloor 2", tax_number: "NTN-001 / A" })).toEqual({ ...values, name: "City Pharmacy", contact_person: null, phone: null, email: null, address: "12 Main Road\nFloor 2", city: null, tax_number: "NTN-001 / A" });
  });
  it.each(["03001234567", "+923001234567", "+92 300 1234567", "+44 (20) 7946-0958", "(212) 555-0123 ext. 45", "+1 212 555 0123"])('accepts phone format %s without changing it', phone => {
    expect(supplierInformationSchema.parse({ ...values, phone }).phone).toBe(phone);
  });
  it.each([" ", "A"])("rejects invalid company name %j", name => {
    expect(supplierInformationSchema.safeParse({ ...values, name }).success).toBe(false);
  });
  it.each(["test@gmail", "not an email"])("rejects incomplete email %s", email => {
    expect(supplierInformationSchema.safeParse({ ...values, email }).success).toBe(false);
  });
  it.each(["abc", "123", "call Ahmed"])("rejects invalid phone %s", phone => {
    expect(supplierInformationSchema.safeParse({ ...values, phone }).success).toBe(false);
  });
  it("accepts punctuation in names and city names, trims email, and strips unrelated fields", () => {
    const result = supplierInformationSchema.parse({ ...values, contact_person: "Dr. O'Neil & Sons", city: "Dera Ghazi Khan", email: " orders@example.com ", is_active: false, created_by: "forged", id: "other" });
    expect(result).toMatchObject({ contact_person: "Dr. O'Neil & Sons", city: "Dera Ghazi Khan", email: "orders@example.com" });
    expect(Object.keys(result)).toHaveLength(7);
  });
});
