import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#071b45] p-4 sm:p-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,.5),transparent_26rem),radial-gradient(circle_at_90%_80%,rgba(16,185,129,.22),transparent_24rem)]" />
      <div className="absolute inset-0 opacity-[.06] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="relative w-full max-w-md">
        <Link href="/" className="mb-6 flex justify-center"><BrandMark light /></Link>
        {children}
        <p className="mt-6 text-center text-xs text-blue-200">© {new Date().getFullYear()} Qeilvra · Pharmacy Management System</p>
      </div>
    </main>
  );
}
