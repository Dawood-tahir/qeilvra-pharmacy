import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div><p className="text-sm font-bold text-blue-600">404</p><h1 className="mt-2 text-3xl font-extrabold">Page not found</h1><p className="mt-2 text-slate-500">This page does not exist or is not available to your role.</p><Link href="/dashboard" className={buttonVariants({ className: "mt-6" })}><ArrowLeft /> Back to dashboard</Link></div>
    </main>
  );
}
