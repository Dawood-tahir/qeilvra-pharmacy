import { Mail, ShieldCheck, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { requireStaff } from "@/lib/auth";

export default async function ProfilePage() {
  const staff = await requireStaff();
  return <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Account</p><h1 className="mt-1 text-2xl font-extrabold">Your profile</h1><Card className="mt-5"><CardContent className="p-6"><span className="grid size-14 place-items-center rounded-2xl bg-blue-100 text-blue-700"><UserRound className="size-7" /></span><h2 className="mt-4 text-xl font-extrabold">{staff.fullName}</h2><p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Mail className="size-4" /> {staff.email}</p><p className="mt-2 flex items-center gap-2 text-sm capitalize text-slate-600"><ShieldCheck className="size-4" /> {staff.role}</p><p className="mt-5 border-t pt-4 text-sm leading-6 text-slate-500">Ask the Owner to change account status or contact details. Use “Forgot password” on the sign-in page to reset your password securely.</p></CardContent></Card></main>;
}
