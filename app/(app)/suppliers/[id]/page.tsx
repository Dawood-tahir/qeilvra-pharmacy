import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { loadSupplierProfile } from "@/lib/supplier-profile-data";
import { profilePage } from "@/lib/supplier-profile";
import { SupplierProfile } from "@/components/suppliers/supplier-profile";

export default async function SupplierProfilePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; q?: string; page?: string; status?: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const options = {
    tab: ["overview", "alerts", "medicines", "history"].includes(query.tab ?? "") ? query.tab! : "overview",
    query: (query.q ?? "").trim().slice(0, 100), page: profilePage(query.page),
    status: ["posted", "draft", "cancelled"].includes(query.status ?? "") ? query.status! : "all",
  };
  const profile = await loadSupplierProfile(id, options);
  if (!profile) notFound();
  return <SupplierProfile profile={profile} options={options} />;
}
