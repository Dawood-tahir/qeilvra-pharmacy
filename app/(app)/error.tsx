"use client";
import { Button } from "@/components/ui/button";
export default function PageError({ reset }: { reset: () => void }) {
  return <main role="alert" className="mx-auto max-w-lg p-6 sm:p-10"><p className="text-sm font-bold text-blue-700">Qeilvra</p><h1 className="mt-3 text-2xl font-extrabold">Records could not load</h1><p className="mt-3 text-sm leading-6 text-slate-600">Check your connection and try again. If you were saving a transaction, check its history before entering it again.</p><Button className="mt-5" onClick={reset}>Retry</Button></main>;
}
