"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { LoaderCircle, Save } from "lucide-react";
import { medicineSchema, type MedicineFormInput, type MedicineFormValues } from "@/app/(app)/medicines/schema";
import { saveMedicineAction } from "@/app/(app)/medicines/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Category = { id: string; name: string };

export function MedicineForm({ id = null, categories, initialValues }: { id?: string | null; categories: Category[]; initialValues?: Partial<MedicineFormValues> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, formState: { errors } } = useForm<MedicineFormInput, unknown, MedicineFormValues>({
    resolver: zodResolver(medicineSchema),
    defaultValues: {
      name: "", generic_name: "", manufacturer: "", category_id: "", strength: "",
      dosage_form: "", barcode: "", sku: "", purchase_price: 0, selling_price: 0,
      reorder_level: 10, base_unit: "unit", units_per_pack: 1, is_active: true,
      ...initialValues,
    },
  });
  const submit = (values: MedicineFormValues) => startTransition(async () => {
    const result = await saveMedicineAction(id, values);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(id ? "Medicine updated." : "Medicine added.");
    router.push(`/medicines/${result.id}`); router.refresh();
  });
  const fieldError = (key: keyof MedicineFormValues) => errors[key]?.message ? <span className="mt-1 block text-xs text-red-600">{String(errors[key]?.message)}</span> : null;

  return <form onSubmit={handleSubmit(submit)} className="space-y-6">
    <section><h2 className="text-base font-bold">Medicine details</h2><p className="mt-1 text-xs text-slate-500">Information used to identify and sell this item.</p><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <label><span className="mb-1.5 block text-sm font-semibold">Medicine name *</span><Input {...register("name")} autoFocus />{fieldError("name")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Generic name</span><Input {...register("generic_name")} />{fieldError("generic_name")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Brand / manufacturer</span><Input {...register("manufacturer")} />{fieldError("manufacturer")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Category</span><select {...register("category_id")} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{fieldError("category_id")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Strength</span><Input {...register("strength")} placeholder="e.g. 500mg" />{fieldError("strength")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Dosage form</span><Input {...register("dosage_form")} placeholder="Tablet, syrup…" />{fieldError("dosage_form")}</label>
    </div></section>
    <section className="border-t border-slate-100 pt-6"><h2 className="text-base font-bold">Codes, units and pricing</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <label><span className="mb-1.5 block text-sm font-semibold">SKU *</span><Input {...register("sku")} />{fieldError("sku")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Barcode</span><Input {...register("barcode")} inputMode="numeric" />{fieldError("barcode")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Base unit *</span><Input {...register("base_unit")} placeholder="tablet" />{fieldError("base_unit")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Units per pack *</span><Input type="number" step="0.001" {...register("units_per_pack")} />{fieldError("units_per_pack")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Default purchase price (Rs.) *</span><Input type="number" step="0.01" {...register("purchase_price")} />{fieldError("purchase_price")}<span className="mt-1 block text-[11px] text-slate-500">Owner-only planning value. Actual costs are recorded per batch.</span></label>
      <label><span className="mb-1.5 block text-sm font-semibold">Selling price (Rs.) *</span><Input type="number" step="0.01" {...register("selling_price")} />{fieldError("selling_price")}</label>
      <label><span className="mb-1.5 block text-sm font-semibold">Low-stock level *</span><Input type="number" step="0.001" {...register("reorder_level")} />{fieldError("reorder_level")}</label>
      <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 p-3"><input type="checkbox" {...register("is_active")} className="size-4 accent-blue-600" /><span><span className="block text-sm font-semibold">Active medicine</span><span className="block text-[11px] text-slate-500">Inactive items cannot be sold.</span></span></label>
    </div></section>
    <div className="flex justify-end border-t border-slate-100 pt-5"><Button disabled={pending} size="lg">{pending ? <LoaderCircle className="animate-spin" /> : <Save />} {id ? "Save changes" : "Add medicine"}</Button></div>
  </form>;
}
