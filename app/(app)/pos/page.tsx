import type { Metadata } from "next";
import { PosWorkspace } from "@/components/pos/pos-workspace";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "POS / Sales" };

export default async function PosPage() {
  const staff = await requireStaff();
  return <PosWorkspace role={staff.role} />;
}
