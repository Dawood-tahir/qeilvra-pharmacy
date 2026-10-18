import { describe, expect, it } from "vitest";
import { cartBaseQuantity, humanStock, priceSuggestion, stockQuantity, toMinor } from "@/lib/medicine-units";
import { guidedMedicineSchema, receiveStockSchema } from "@/lib/guided-medicine";
const units=[{unit_key:"base",label:"tablet",base_quantity:1,selling_price:7},{unit_key:"strip",label:"strip",base_quantity:10,selling_price:65},{unit_key:"box",label:"box",base_quantity:100,selling_price:620}];
describe("physical quantities and currency",()=>{
 it("converts confirmed packaging without fixed pack sizes",()=>{expect(stockQuantity(2,10*10)).toBe(200);expect(stockQuantity(2,7*3)).toBe(42);expect(stockQuantity(0.5,100)).toBe(0);expect(stockQuantity(2.5,7)).toBe(0);});
 it("keeps mixed units of the same medicine in one stock budget",()=>{expect(cartBaseQuantity(units.map((unit)=>({id:"a",quantity:1,unit})),"a")).toBe(111);});
 it("uses exact minor units for mixed selling prices",()=>{expect(toMinor("7")+toMinor("80")+toMinor("150")).toBe(23700);expect(toMinor("0.10")*3+toMinor("0.20")).toBe(50);expect(priceSuggestion("7",10)).toBe("70.00");});
 it("expresses stock as boxes strips and tablets",()=>{expect(humanStock(234,"tablet",units)).toBe("2 boxes + 3 strips + 4 tablets");});
});
describe("guided medicine validation",()=>{
 const identity={name:"Paracetamol",dosage_form:"Tablet",strength:"500mg",barcode:"",manufacturer:"",tablets_per_strip:10,strips_per_box:10,units:[{unit_key:"base",selling_price:"7",max_price:null},{unit_key:"strip",selling_price:"65",max_price:null},{unit_key:"box",selling_price:"620",max_price:null}]};
 it("allows independent prices for confirmed packaging",()=>expect(guidedMedicineSchema.safeParse(identity).success).toBe(true));
 it("rejects fractions and missing batch expiry",()=>{expect(receiveStockSchema.safeParse({unit_key:"base",quantity:0.5,batch_number:"B",expiry_date:"2099-12-31",total_cost:"1"}).success).toBe(false);expect(receiveStockSchema.safeParse({unit_key:"base",quantity:1,batch_number:"",expiry_date:"",total_cost:"1"}).success).toBe(false);});
 it("rejects sealed-product splitting and prices above the limit",()=>{expect(guidedMedicineSchema.safeParse({...identity,dosage_form:"Syrup"}).success).toBe(false);expect(guidedMedicineSchema.safeParse({...identity,units:[{unit_key:"base",selling_price:"8",max_price:"7"}]}).success).toBe(false);});
});
