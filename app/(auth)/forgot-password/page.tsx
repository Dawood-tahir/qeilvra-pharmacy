import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const params = await searchParams;
  return <Card className="p-6 sm:p-8">{params.sent ? <div className="text-center"><span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><MailCheck /></span><h1 className="text-2xl font-bold">Check your email</h1><p className="mt-2 text-sm leading-6 text-slate-500">If an active account exists for that address, a secure reset link has been sent.</p></div> : <><h1 className="text-2xl font-bold">Reset password</h1><p className="mt-1 text-sm text-slate-500">We’ll email a secure password reset link.</p>{params.error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Enter a valid email address.</p>}<form action={forgotPasswordAction} className="mt-6 space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-semibold">Email address</span><Input name="email" type="email" required autoFocus /></label><Button className="w-full">Send reset link</Button></form></>}<Link href="/login" className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft className="size-4" /> Back to sign in</Link></Card>;
}
