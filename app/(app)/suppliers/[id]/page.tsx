import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOperationsManager } from "@/lib/auth";
import { loadSupplierProfile } from "@/lib/supplier-profile-data";
import { searchQuery } from "@/lib/live-search";
import { profilePage } from "@/lib/supplier-profile";
import { SupplierProfile } from "@/components/suppliers/supplier-profile";

export default async function SupplierProfilePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; q?: string | string[]; page?: string; status?: string }>;
}) {
  await requireOperationsManager();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const options = {
    tab: ["overview", "alerts", "medicines", "history"].includes(query.tab ?? "") ? query.tab! : "overview",
    query: searchQuery(query.q), page: profilePage(query.page),
    status: ["posted", "draft", "cancelled"].includes(query.status ?? "") ? query.status! : "all",
  };
  const profile = await loadSupplierProfile(id, options);
  if (!profile) notFound();
  return <SupplierProfile key={id + ":" + options.tab} profile={profile} options={options} />;
}
