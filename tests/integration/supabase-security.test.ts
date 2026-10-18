import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
const env={url:process.env.SUPABASE_TEST_URL,key:process.env.SUPABASE_TEST_PUBLISHABLE_KEY,ownerEmail:process.env.TEST_OWNER_EMAIL,ownerPassword:process.env.TEST_OWNER_PASSWORD,salespersonEmail:process.env.TEST_SALESPERSON_EMAIL,salespersonPassword:process.env.TEST_SALESPERSON_PASSWORD};
describe.skipIf(!Object.values(env).every(Boolean))("configured Supabase HTTP role and concurrency contracts",()=>{
 it("enforces cost privacy and serializes competing checkout",async()=>{
  const owner=createClient(env.url!,env.key!,{auth:{persistSession:false}});
  const salesperson=createClient(env.url!,env.key!,{auth:{persistSession:false}});
  expect((await owner.auth.signInWithPassword({email:env.ownerEmail!,password:env.ownerPassword!})).error).toBeNull();
  expect((await salesperson.auth.signInWithPassword({email:env.salespersonEmail!,password:env.salespersonPassword!})).error).toBeNull();
  const marker=crypto.randomUUID().slice(0,8);
  const {data,error}=await owner.rpc("save_guided_medicine",{p_id:null,p_data:{name:"Concurrency Test "+marker,dosage_form:"Tablet",strength:"",barcode:"",manufacturer:"",tablets_per_strip:null,strips_per_box:null,units:[{unit_key:"base",selling_price:"20",max_price:null}]},p_stock:{unit_key:"base",quantity:1,batch_number:"B-"+marker,expiry_date:"2099-12-31",total_cost:"10"},p_key:crypto.randomUUID()});
  expect(error).toBeNull();const medicineId=data.id;
  expect((await salesperson.from("medicine_batches").select("purchase_cost").eq("medicine_id",medicineId)).data).toEqual([]);
  expect((await salesperson.from("medicines").update({selling_price:1}).eq("id",medicineId)).error?.code).toBe("42501");
  expect((await salesperson.from("medicine_units").update({selling_price:1}).eq("medicine_id",medicineId)).error?.code).toBe("42501");
  const checkout=(key:string)=>salesperson.rpc("checkout_sale",{p_items:[{medicine_id:medicineId,unit_key:"base",quantity:1,expected_price:"20"}],p_payment_method:"cash",p_tendered_amount:20,p_discount:0,p_idempotency_key:key});
  const results=await Promise.all([checkout(crypto.randomUUID()),checkout(crypto.randomUUID())]);
  expect(results.filter((r)=>r.error)).toHaveLength(1);expect(results.filter((r)=>r.data)).toHaveLength(1);
  expect((await owner.rpc("receive_stock",{p_id:medicineId,p_stock:{unit_key:"base",quantity:1,batch_number:"RETRY-"+marker,expiry_date:"2099-12-31",total_cost:"10"},p_key:crypto.randomUUID()})).error).toBeNull();
  const key=crypto.randomUUID();const [first,second]=await Promise.all([checkout(key),checkout(key)]);
  expect(first.error).toBeNull();expect(second.error).toBeNull();expect(second.data?.[0]?.sale_id).toBe(first.data?.[0]?.sale_id);
 },30000);
});
