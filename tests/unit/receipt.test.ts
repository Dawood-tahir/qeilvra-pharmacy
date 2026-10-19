import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const snapshot = vi.hoisted(() => ({ method: "cash", price: 7, extra: 0 }));
beforeEach(() => { snapshot.method = "cash"; snapshot.price = 7; snapshot.extra = 0; });
vi.mock("@/lib/auth",()=>({requireStaff:async()=>({id:"staff",role:"salesperson"}),requireOwner:async()=>({id:"owner",role:"owner"})}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 from:()=>({select:()=>({eq:()=>({single:async()=>({data:{invoice_number:"QEI-UNITS",status:"completed",completed_at:"2026-10-18T10:00:00Z",subtotal:692,discount:0,extra_charge_amount:snapshot.extra,extra_charge_description:"Delivery",net_total:692+snapshot.extra,profiles:{full_name:"Staff"},sale_items:[{id:"tablet",medicine_name:"Paracetamol 500mg",medicine_sku:"PC",quantity:1,unit_label:"tablet",base_units_per_sale_unit:1,unit_price:snapshot.price,line_total:snapshot.price},{id:"strip",medicine_name:"Paracetamol 500mg",medicine_sku:"PC",quantity:1,unit_label:"strip",base_units_per_sale_unit:10,unit_price:65,line_total:65},{id:"box",medicine_name:"Paracetamol 500mg",medicine_sku:"PC",quantity:1,unit_label:"box",base_units_per_sale_unit:100,unit_price:620,line_total:620}],payments:[{kind:"sale",method:snapshot.method,amount:692,change_amount:8}],sale_returns:[]}})})})}),
 rpc:async()=>({data:[{pharmacy_name:"Qeilvra Pharmacy"}]}),
})}));
import SaleDetailPage from "@/app/(app)/sales/[id]/page";
describe("invoice unit snapshots",()=>{
 it.each(["58","80"])("prints the saved extra amount and description on %smm receipts",async(width)=>{
  snapshot.extra=30;
  const html=renderToStaticMarkup(await SaleDetailPage({params:Promise.resolve({id:"invoice"}),searchParams:Promise.resolve({print:"thermal",width})}));
  expect(html).toContain("Extra Charges");expect(html).toContain("Delivery");expect(html).toContain("30");expect(html).toContain('data-paper="'+width+'mm"');
 });
 it("uses the saved custom price and card method on 58mm receipts",async()=>{
  snapshot.method="card";snapshot.price=6.25;
  const html=renderToStaticMarkup(await SaleDetailPage({params:Promise.resolve({id:"invoice"}),searchParams:Promise.resolve({print:"thermal",width:"58"})}));
  expect(html).toContain("6.25");expect(html).toContain(">card</span>");expect(html).toContain('data-paper="58mm"');
 });
 it.each([{}, {print:"thermal"}])("prints original selling units quantity and charged unit prices",async(searchParams)=>{
  const tree=await SaleDetailPage({params:Promise.resolve({id:"invoice"}),searchParams:Promise.resolve(searchParams)});
  const html=renderToStaticMarkup(tree);
  expect(html).toContain("1 tablet");expect(html).toContain("1 strip");expect(html).toContain("1 box");
  expect(html).toContain("/ tablet");expect(html).toContain("/ strip");expect(html).toContain("/ box");
  expect(html).toContain("692");expect(html).toContain("65");expect(html).toContain("620");
 });
});
