import { updatePasswordAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return <Card className="p-6 sm:p-8"><h1 className="text-2xl font-bold">Choose a new password</h1><p className="mt-1 text-sm text-slate-500">Use at least 10 characters and avoid reused passwords.</p>{params.error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">The passwords must match and contain at least 10 characters.</p>}<form action={updatePasswordAction} className="mt-6 space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-semibold">New password</span><Input name="password" type="password" minLength={10} required /></label><label className="block"><span className="mb-1.5 block text-sm font-semibold">Confirm password</span><Input name="confirmPassword" type="password" minLength={10} required /></label><Button className="w-full">Update password</Button></form></Card>;
}
