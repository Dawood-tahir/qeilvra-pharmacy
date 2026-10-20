"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
export function Dialog({ label, onClose, busy = false, children, fullScreen = false, fallbackFocus, className }: { label: string; onClose: () => void; busy?: boolean; children: React.ReactNode; fullScreen?: boolean; fallbackFocus?: React.RefObject<HTMLElement | null>; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; const previous = document.activeElement as HTMLElement | null; const fallback = fallbackFocus?.current; element?.showModal(); return () => { element?.close(); if (previous?.isConnected && previous !== document.body && previous.getClientRects().length > 0) previous.focus(); else fallback?.focus(); }; }, [fallbackFocus]);
  return <dialog ref={ref} tabIndex={-1} aria-label={label} onKeyDown={(e) => {
    if (e.key !== "Tab") return;
    const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex="0"]')).filter((element) => element.getClientRects().length > 0 && !element.matches(':disabled,[tabindex="-1"]'));
    if (!controls.length) { e.preventDefault(); e.currentTarget.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} className={cn("q-dialog fixed inset-0 z-[90] m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl p-4 text-slate-950 sm:p-6", fullScreen && "h-dvh max-h-dvh w-full max-w-none rounded-none p-0", className)} onClick={(e) => { if (e.target === e.currentTarget && !busy) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose(); } }}>{children}</dialog>;
}
