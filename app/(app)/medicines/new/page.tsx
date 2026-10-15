import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MedicineForm } from "@/components/medicines/medicine-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function NewMedicinePage() {
  await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.from("medicine_categories").select("id,name").eq("is_active", true).order("name");
  return <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8"><Link href="/medicines" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700"><ArrowLeft className="size-4" /> Medicines</Link><div className="mt-4"><h1 className="text-2xl font-extrabold sm:text-3xl">Add medicine</h1><p className="mt-1 text-sm text-slate-500">Create the catalogue record. Stock is added separately through a posted purchase.</p></div><Card className="mt-5"><CardContent className="p-5 sm:p-7"><MedicineForm categories={data ?? []} /></CardContent></Card></main>;
}
