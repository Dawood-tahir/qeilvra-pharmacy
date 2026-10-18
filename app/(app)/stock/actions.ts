"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
export async function correctStockAction(input:unknown) {
 await requireOwner();
 const parsed=z.object({batchId:z.uuid(),countedQuantity:z.number().int().nonnegative().max(999999999),expectedQuantity:z.number().nonnegative(),reason:z.string().trim().min(3).max(500)}).safeParse(input);
 if(!parsed.success)return {ok:false as const,error:parsed.error.issues[0]?.message??"Check the stock count."};
 const supabase=await createClient();
 const {data,error}=await supabase.rpc("correct_stock",{p_batch_id:parsed.data.batchId,p_counted_quantity:parsed.data.countedQuantity,p_expected_quantity:parsed.data.expectedQuantity,p_reason:parsed.data.reason});
 if(error)return {ok:false as const,error:error.message.startsWith("Stock changed")?error.message:"Stock could not be corrected. Check the quantity and try again."};
 for(const path of ["/stock","/medicines","/dashboard"])revalidatePath(path);
 return {ok:true as const,quantity:Number(data)};
}
