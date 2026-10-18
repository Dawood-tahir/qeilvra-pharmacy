import { beforeEach, describe, expect, it, vi } from "vitest";
const {rpc,getUser}=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser},rpc})}));
import { POST } from "@/app/api/checkout/route";
const payload={idempotencyKey:"bbbbbbbb-0000-4000-8000-000000000001",items:[{medicineId:"aaaaaaaa-0000-4000-8000-000000000001",unitKey:"strip",quantity:1,expectedPrice:"65.00"}],paymentMethod:"cash",tenderedAmount:65,discount:0};
const request=(data:unknown)=>new Request("http://localhost/api/checkout",{method:"POST",body:JSON.stringify(data)});
beforeEach(()=>{vi.resetAllMocks();getUser.mockResolvedValue({data:{user:{id:"staff"}}});rpc.mockResolvedValue({data:[{sale_id:"sale",invoice_number:"QEI",net_total:65,change_amount:0}],error:null});});
describe("checkout boundary",()=>{
 it("passes a unit selection rather than a client price override",async()=>{expect((await POST(request(payload))).status).toBe(201);expect(rpc).toHaveBeenCalledWith("checkout_sale",expect.objectContaining({p_items:[{medicine_id:payload.items[0].medicineId,quantity:1,unit_key:"strip",expected_price:"65.00"}]}));});
 it("rejects fractional quantities before database checkout",async()=>{expect((await POST(request({...payload,items:[{...payload.items[0],quantity:0.5}]}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
 it("requires a fresh authenticated user",async()=>{getUser.mockResolvedValue({data:{user:null}});expect((await POST(request(payload))).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
 it("keeps transport uncertainty distinct from a rejected transaction",async()=>{rpc.mockResolvedValue({data:null,error:{code:"",message:"fetch failed"}});expect((await POST(request(payload))).status).toBe(503);rpc.mockResolvedValue({data:null,error:{code:"P0001",message:"Only 3 tablets are available."}});expect((await POST(request(payload))).status).toBe(409);});
});
