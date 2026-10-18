"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";

type Result = { ok: boolean; error?: string; message?: string; uncertain?: boolean };

// Keep the same server action and its authorization; only manage form feedback.
export function ActionForm({ action, children, className, resetOnSuccess = false, pendingMessage = "Saving...", checkHref }: {
  action: (data: FormData) => Promise<Result>; children: React.ReactNode;
  className?: string; resetOnSuccess?: boolean; pendingMessage?: string; checkHref?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const busy = useRef(false);
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (busy.current || (result?.uncertain && checkHref)) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    busy.current = true; setResult(null);
    startTransition(async () => {
      try {
        const response = await action(data);
        setResult(response);
        if (response.ok && resetOnSuccess) form.reset();
      } catch { setResult({ ok: false, uncertain: true, error: "Could not confirm the save. Your entries are kept. Check the saved records before trying again." }); }
      finally { busy.current = false; }
    });
  }}>
    <fieldset disabled={pending || Boolean(result?.uncertain && checkHref)} aria-busy={pending} className={className}>{children}</fieldset>
    {pending && <p role="status" className="mt-2 text-sm text-blue-700">{pendingMessage}</p>}
    {result && <p role={result.ok ? "status" : "alert"} className={"mt-2 rounded-xl p-3 text-sm " + (result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")}>{result.ok ? result.message ?? "Saved successfully." : result.error ?? "Could not save. Check your entries and try again."}</p>}
    {result?.uncertain && checkHref && <Link href={checkHref} className="inline-flex min-h-11 items-center text-sm font-bold text-blue-700 underline">Check saved records</Link>}
  </form>;
}
