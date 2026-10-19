"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dispositionSchema, recoverySchema } from "@/lib/stock-disposition";
import { saveOutcomeUnknown } from "@/lib/save-result";

function refreshStock() {
 for (const path of ["/stock", "/medicines", "/dashboard", "/reports", "/pos", "/suppliers", "/purchases"]) revalidatePath(path);
 revalidatePath("/suppliers/[id]", "page"); revalidatePath("/purchases/[id]", "page");
}
export async function disposeStockAction(input: unknown) {
 await requireOwner();
 const parsed=dispositionSchema.safeParse(input);
 if(!parsed.success)return {ok:false as const,error:parsed.error.issues[0]?.message??"Check the stock details."};
 const value=parsed.data; const supabase=await createClient();
 const {data,error}=await supabase.rpc("dispose_stock",{p_key:value.key,p_batch_id:value.batchId,p_kind:value.kind,p_quantity:value.quantity,p_expected_quantity:value.expectedQuantity,p_reason:value.reason,p_supplier_id:value.supplierId,p_method:value.method});
 if(error)return {ok:false as const,uncertain:saveOutcomeUnknown(error.code)||error.code==="42501",error:error.code==="P0001"?error.message:"Stock action could not be confirmed. Retry the same action to check its status."};
 if(!data?.id)return {ok:false as const,uncertain:true,error:"Stock action could not be confirmed. Retry the same action."};
 refreshStock(); return {ok:true as const,id:String(data.id),quantity:Number(data.quantity),value:Number(data.value)};
}
export async function confirmSupplierRecoveryAction(input: unknown) {
 await requireOwner();
 const parsed=recoverySchema.safeParse(input);
 if(!parsed.success)return {ok:false as const,error:parsed.error.issues[0]?.message??"Check the supplier settlement."};
 const value=parsed.data; const supabase=await createClient();
 const {data,error}=await supabase.rpc("confirm_supplier_recovery",{p_key:value.key,p_id:value.dispositionId,p_method:value.method,p_amount:value.amount,p_reference:value.reference,p_replacement:value.method==="replacement"?value.replacement:null});
 if(error)return {ok:false as const,uncertain:saveOutcomeUnknown(error.code)||error.code==="42501",error:error.code==="P0001"?error.message:"Supplier settlement could not be confirmed. Retry the same action."};
 if(!data?.id)return {ok:false as const,uncertain:true,error:"Settlement could not be confirmed. Retry the same action."};
 refreshStock(); return {ok:true as const,id:String(data.id)};
}
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
