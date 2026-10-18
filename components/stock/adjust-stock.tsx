"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LoaderCircle, SlidersHorizontal, X } from "lucide-react";
import { correctStockAction } from "@/app/(app)/stock/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

export function AdjustStock({ batchId, medicine, batch, quantity, unit = "unit" }: { batchId: string; medicine: string; batch: string; quantity: number; unit?: string }) {
  const [open,setOpen]=useState(false);
  const [count,setCount]=useState("");
  const [reason,setReason]=useState("");
  const [review,setReview]=useState(false);
  const [error,setError]=useState("");
  const [pending,startTransition]=useTransition();
  function save() {
    const actual=Number(count);
    if(count==="" || !Number.isSafeInteger(actual) || actual<0) {setError("Enter the whole number of items you physically counted.");return;}
    if(reason.trim().length<3) {setError("Explain why the recorded stock needs to change.");return;}
    if(!review) {setReview(true);setError("");return;}
    startTransition(async()=>{
      try{
        const result=await correctStockAction({batchId,countedQuantity:actual,expectedQuantity:quantity,reason});
        if(!result.ok){setError(result.error);return;}
        toast.success("Stock count saved. Available batch stock: "+result.quantity+" "+unit+"s.");
        setOpen(false);setReview(false);
      }catch{setError("The stock count could not be confirmed. Your entries are kept; try again.");}
    });
  }
  return <><Button variant="ghost" size="sm" onClick={()=>{setOpen(true);setReview(false);setError("");}}><SlidersHorizontal/> Correct Stock</Button>{open&&<Dialog label="Correct Stock" busy={pending} onClose={()=>setOpen(false)}><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">Correct Stock</h2><p className="mt-1 text-sm font-bold">{medicine}</p><p className="mt-1 text-xs text-slate-500">Batch {batch} | recorded: {quantity} {unit}s</p></div><Button variant="ghost" size="icon" disabled={pending} aria-label="Close stock correction" onClick={()=>setOpen(false)}><X/></Button></div><form className="mt-5 space-y-4" onSubmit={(e)=>{e.preventDefault();if(!pending)save();}}><label className="block"><span className="mb-2 block text-sm font-semibold">How many {unit}s did you count?</span><Input autoFocus inputMode="numeric" type="number" min="0" step="1" value={count} disabled={review||pending} onChange={(e)=>setCount(e.target.value)}/></label><label className="block"><span className="mb-2 block text-sm font-semibold">Why does the stock need correcting?</span><textarea className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm" value={reason} disabled={review||pending} onChange={(e)=>setReason(e.target.value)} maxLength={500}/></label>{review&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Change this batch from <strong>{quantity}</strong> to <strong>{count} {unit}s</strong>. This correction is recorded in the stock history.</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex gap-2">{review&&<Button type="button" variant="outline" disabled={pending} onClick={()=>setReview(false)}>Back</Button>}<Button className="flex-1" disabled={pending}>{pending&&<LoaderCircle className="animate-spin"/>}{review?"Save Stock Count":"Review Stock Count"}</Button></div></form></Dialog>}</>;
}
