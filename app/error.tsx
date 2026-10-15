"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600"><AlertTriangle /></span>
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">The operation was not completed. Your saved records were not changed. Try again, or contact the system owner if this continues.</p>
        <Button className="mt-6" onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
