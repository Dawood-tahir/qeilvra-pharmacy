import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MedicineForm } from "@/components/medicines/medicine-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function EditMedicinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: medicine }, { data: units }] = await Promise.all([
    supabase.from("medicines").select("*").eq("id", id).single(),
    supabase.from("medicine_units").select("unit_key,label,base_quantity,selling_price,max_price").eq("medicine_id", id),
  ]);
  if (!medicine) notFound();
  return <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8"><Link href={`/medicines/${id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft className="size-4" /> Medicine details</Link><h1 className="mt-4 text-2xl font-extrabold sm:text-3xl">Edit medicine</h1><p className="mt-1 text-sm text-slate-500">Confirm packaging and set selling prices. Changes are recorded in the audit history.</p><Card className="mt-5"><CardContent className="p-5 sm:p-7"><MedicineForm id={id} initialValues={{ ...medicine, units: units ?? [] }} /></CardContent></Card></main>;
}
