import { LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { loginAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";

const errors: Record<string, string> = {
  invalid: "Enter a valid email address and password.",
  credentials: "The email or password is incorrect.",
  inactive: "This account is inactive. Ask the pharmacy owner for help.",
  expired: "Your sign-in link expired. Please sign in again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  return (
    <Card className="border-white/50 p-6 shadow-2xl sm:p-8">
      <div className="mb-6">
        <span className="mb-4 grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-700"><ShieldCheck /></span>
        <h1 className="text-2xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to your secure pharmacy workspace.</p>
      </div>
      {!isSupabaseConfigured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex gap-2 font-bold"><TriangleAlert className="size-5 shrink-0" /> Supabase setup required</div>
          <p className="mt-2 leading-6">Copy <code>.env.example</code> to <code>.env.local</code>, add the project URL and publishable key, then apply the migrations. No demo financial data is shown as real data.</p>
        </div>
      ) : (
        <form action={loginAction} className="space-y-4">
          {params.error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errors[params.error] ?? "Sign in could not be completed."}</div>}
          <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Email address</span><span className="relative block"><Mail className="absolute left-3 top-3.5 size-4 text-slate-400" /><Input className="pl-10" name="email" type="email" autoComplete="email" autoFocus required placeholder="you@pharmacy.com" /></span></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Password</span><span className="relative block"><LockKeyhole className="absolute left-3 top-3.5 size-4 text-slate-400" /><Input className="pl-10" name="password" type="password" autoComplete="current-password" required /></span></label>
          <div className="flex justify-end"><Link href="/forgot-password" className="text-sm font-semibold text-blue-700 hover:underline">Forgot password?</Link></div>
          <Button className="w-full" size="lg">Sign in</Button>
        </form>
      )}
      <p className="mt-6 border-t border-slate-100 pt-4 text-center text-xs leading-5 text-slate-500">Accounts are created by the Owner. Public registration is disabled.</p>
    </Card>
  );
}
