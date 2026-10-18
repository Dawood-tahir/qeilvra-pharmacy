import { test, expect, type Page } from "@playwright/test";
const medicine={id:"40000000-0000-0000-0000-000000000004",name:"Paracetamol",strength:"500mg",dosage_form:"Tablet",sku:"PC",base_unit:"tablet",selling_price:7,available_quantity:200,stock_status:"in_stock",packaging_status:"confirmed",units:[{unit_key:"base",label:"tablet",base_quantity:1,selling_price:7},{unit_key:"strip",label:"strip",base_quantity:10,selling_price:65},{unit_key:"box",label:"box",base_quantity:100,selling_price:620}]};
async function search(page:Page,items:unknown[]=[medicine]) { await page.route("**/api/medicines/search?**",route=>route.fulfill({json:items})); }
async function noOverflow(page:Page) { expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true); }
test("beginner adds two boxes in three steps with independent prices",async({page})=>{
 await search(page,[]);
 let payload:Record<string,unknown>|undefined;
 await page.route("**/__test/save",async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{ok:true,id:medicine.id,quantity:200}});});
 await page.goto("/?flow=new");
 await page.getByLabel("Medicine Name").fill("Paracetamol");
 await page.getByLabel("Strength").fill("500mg");
 await page.getByRole("button",{name:"Next",exact:true}).click();
 await expect(page.getByText("Step 2 of 3")).toBeVisible();
 await page.getByRole("button",{name:"Boxes",exact:true}).click();
 await page.getByLabel("How many did you buy?").fill("2");
 await page.getByLabel("How many tablets are in one strip?").fill("10");
 await page.getByLabel("How many strips are in one box?").fill("10");
 await expect(page.getByText("Total stock: 200 tablets")).toBeVisible();
 await page.getByLabel("Batch number").fill("A1");
 await page.getByLabel("Expiry date").fill("2027-12-25");
 await page.getByLabel("Total purchase cost").fill("400");
 await page.getByRole("button",{name:"Next",exact:true}).click();
 await page.getByRole("textbox",{name:/^Price of 1 Tablet/}).fill("7");
 await expect(page.getByRole("textbox",{name:/^Price of 1 Strip/})).toHaveValue("70.00");
 await page.getByRole("textbox",{name:/^Price of 1 Strip/}).fill("65");
 await page.getByRole("textbox",{name:/^Price of 1 Box/}).fill("620");
 await noOverflow(page);
 await page.screenshot({path:"test-results/wizard-"+test.info().project.name+".png",fullPage:true});
 await page.getByRole("button",{name:"Save Medicine",exact:true}).click();
 await expect(page.getByText("200 tablets are now available.")).toBeVisible();
 expect(payload?.stock).toMatchObject({quantity:2,unit_key:"box",batch_number:"A1"});
 expect(payload?.data).toMatchObject({tablets_per_strip:10,strips_per_box:10,units:[{unit_key:"base",selling_price:"7"},{unit_key:"strip",selling_price:"65"},{unit_key:"box",selling_price:"620"}]});
});
test("duplicate check preserves entered identification",async({page})=>{
 await search(page);await page.goto("/?flow=new");
 await page.getByLabel("Medicine Name").fill("Paracetamol");
 await page.getByLabel("Strength").fill("500mg");
 await page.getByRole("button",{name:"Next",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("already exists");
 await expect(page.getByLabel("Medicine Name")).toHaveValue("Paracetamol");
});
test("restocking reuses medicine and shows stock after adding",async({page})=>{
 await search(page,[{...medicine,available_quantity:45}]);
 let payload:Record<string,unknown>|undefined;
 await page.route("**/__test/receive",async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{ok:true,id:medicine.id,quantity:100}});});
 await page.goto("/?flow=restock");await page.getByRole("button",{name:/Paracetamol/}).click();
 await page.getByRole("button",{name:"box",exact:true}).click();
 await page.getByLabel("How many did you buy?").fill("1");
 await page.getByLabel("Batch number").fill("NEW");
 await page.getByLabel("Expiry date").fill("2027-12-25");
 await page.getByLabel("Total purchase cost").fill("200");
 await expect(page.getByText("Stock after adding: 145 tablets")).toBeVisible();
 await page.getByRole("button",{name:"Review Stock"}).click();
 await noOverflow(page);
 await page.getByRole("button",{name:"Add to Stock",exact:true}).click();
 await expect(page.getByText("Stock added successfully.")).toBeVisible();
 expect(payload?.id).toBe(medicine.id);
});
test("mixed-unit POS totals and cart survive refresh",async({page})=>{
 await search(page);
 let payload:Record<string,unknown>|undefined;
 await page.route("**/api/checkout",async route=>{payload=route.request().postDataJSON();await route.fulfill({status:201,json:{sale_id:"sale",invoice_number:"QEI-TEST",net_total:692,change_amount:8}});});
 await page.goto("/?flow=pos");
 const card=page.getByRole("article",{name:"Paracetamol 500mg"});
 await card.getByRole("button",{name:"Add to Cart"}).click();
 await card.getByRole("button",{name:"strip",exact:true}).click();
 await card.getByRole("button",{name:"Add to Cart"}).click();
 await card.getByRole("button",{name:"box",exact:true}).click();
 await card.getByRole("button",{name:"Add to Cart"}).click();
 await page.reload();
 if(page.viewportSize()!.width<1024) await page.getByRole("button",{name:/Cart & Checkout/}).click();
 await expect(page.getByText(/692/).filter({visible:true}).first()).toBeVisible();
 await noOverflow(page);
 await page.screenshot({path:"test-results/pos-"+test.info().project.name+".png",fullPage:true});
 await page.getByRole("button",{name:"Checkout",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Complete sale"});
 await dialog.getByLabel("Cash received").fill("700");
 await dialog.getByRole("button",{name:"Complete Sale",exact:true}).click();
 await expect(page.getByRole("heading",{name:"QEI-TEST"})).toBeVisible();
 expect(payload?.items).toEqual([{medicineId:medicine.id,unitKey:"base",quantity:1,expectedPrice:"7.00"},{medicineId:medicine.id,unitKey:"strip",quantity:1,expectedPrice:"65.00"},{medicineId:medicine.id,unitKey:"box",quantity:1,expectedPrice:"620.00"}]);
 await expect(page.getByRole("link",{name:"Print receipt"})).toHaveAttribute("href","/sales/sale?print=thermal");
});
test("lost checkout response retries the exact request",async({page})=>{
 await search(page);let first:unknown;let attempts=0;
 await page.route("**/api/checkout",async route=>{const payload=route.request().postDataJSON();attempts++;if(attempts===1){first=payload;await route.abort("failed");}else{expect(payload).toEqual(first);await route.fulfill({status:201,json:{sale_id:"retry-sale",invoice_number:"QEI-RETRY",net_total:7,change_amount:0}});}});
 await page.goto("/?flow=pos");
 await page.getByRole("button",{name:"Add to Cart"}).click();
 if(page.viewportSize()!.width<1024) await page.getByRole("button",{name:/Cart & Checkout/}).click();
 await page.getByRole("button",{name:"Checkout",exact:true}).click();
 await page.getByRole("button",{name:"Exact amount"}).click();
 await page.getByRole("button",{name:"Complete Sale",exact:true}).click();
 await expect(page.getByRole("button",{name:"Retry Sale",exact:true}).last()).toBeEnabled();
 await page.getByRole("dialog",{name:"Complete sale"}).getByRole("button",{name:"Retry Sale",exact:true}).click();
 await expect(page.getByRole("heading",{name:"QEI-RETRY"})).toBeVisible();
 expect(attempts).toBe(2);
});

test("inventory offers clear actions and useful mobile stock cards",async({page})=>{
 await page.route("**/__test/inventory?**",route=>route.fulfill({json:[{...medicine,available_quantity:234},{...medicine,id:"other",name:"Amoxicillin",available_quantity:3,stock_status:"low_stock"}]}));
 await page.goto("/medicines");
 await expect(page.getByRole("link",{name:"Add New Medicine",exact:true})).toBeVisible();
 await expect(page.getByRole("link",{name:"Add More Stock",exact:true})).toBeVisible();
 await expect(page.getByText("2 boxes + 3 strips + 4 tablets").filter({visible:true})).toBeVisible();
 await expect(page.getByRole("link",{name:"View Details",exact:true}).filter({visible:true})).toHaveCount(2);
 await noOverflow(page);
 await page.screenshot({path:"test-results/inventory-"+test.info().project.name+".png",fullPage:true});
 await page.getByRole("link",{name:"View Low Stock",exact:true}).click();
 await expect(page).toHaveURL(/filter=low_stock/);
});
test("salesperson inventory has no master data actions",async({page})=>{
 await page.route("**/__test/inventory?**",route=>route.fulfill({json:[medicine]}));
 await page.goto("/medicines?role=salesperson");
 await expect(page.getByRole("heading",{name:"Inventory",exact:true})).toBeVisible();
 await expect(page.getByRole("link",{name:"Add New Medicine",exact:true})).toHaveCount(0);
 await expect(page.getByRole("link",{name:"Add More Stock",exact:true})).toHaveCount(0);
});

test("payment keeps keyboard focus inside and restores counter controls",async({page})=>{
 await search(page);
 await page.goto("/?flow=pos");
 await page.getByRole("button",{name:"Add to Cart"}).click();
 if(page.viewportSize()!.width<1024)await page.getByRole("button",{name:/Cart & Checkout/}).click();
 await page.getByRole("button",{name:"Checkout",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Complete sale"});
 await dialog.getByLabel("Cash received").fill("7");
 for(let i=0;i<12;i++){await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.closest("dialog")?.getAttribute("aria-label"))).toBe("Complete sale");}
 await page.keyboard.press("Escape");
 if(page.viewportSize()!.width<1024)await expect(page.getByRole("button",{name:/Cart & Checkout/})).toBeFocused();
 else await expect(page.getByRole("button",{name:"Checkout",exact:true})).toBeFocused();
});
