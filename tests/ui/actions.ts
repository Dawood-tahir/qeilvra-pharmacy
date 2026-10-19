async function submit(path: string, body: unknown) { const result=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return result.json(); }
export async function saveGuidedMedicineAction(id: string|null,data: unknown,stock:unknown,key:string) { return submit("/__test/save",{id,data,stock,key}); }
export async function receiveStockAction(id:string,stock:unknown,key:string) { return submit("/__test/receive",{id,stock,key}); }
export async function createPurchaseAction(data: unknown) { return submit("/__test/purchase", data); }
export async function postPurchaseAction(data: FormData) { return submit("/__test/post", Object.fromEntries(data)); }
export async function requestReturnAction(data: unknown) { return submit("/__test/return", data); }
export async function completeReturnAction(data: unknown) { return submit("/__test/complete-return", data); }
export async function reviewReturnAction(data: unknown) { return submit("/__test/review", data); }
export async function createExpenseAction(data: FormData) { return submit("/__test/expense", Object.fromEntries(data)); }
export async function createExpenseCategoryAction(data: FormData) { return submit("/__test/category", Object.fromEntries(data)); }
export async function createSupplierAction(data: FormData) { return submit("/__test/supplier", Object.fromEntries(data)); }
export async function setSupplierActiveAction(data: FormData) { return submit("/__test/supplier-status", Object.fromEntries(data)); }
export async function inviteSalespersonAction(data: FormData) { return submit("/__test/invite", Object.fromEntries(data)); }
export async function setSalespersonActiveAction(data: FormData) { return submit("/__test/staff-status", Object.fromEntries(data)); }
export async function saveSettingsAction(data: FormData) { return submit("/__test/settings", Object.fromEntries(data)); }
export async function createMedicineCategoryAction(data: FormData) { return submit("/__test/medicine-category", Object.fromEntries(data)); }
export async function correctStockAction(data: unknown) { return submit("/__test/correct-stock", data); }

export async function disposeStockAction(data: unknown) { return submit("/__test/dispose-stock", data); }
export async function confirmSupplierRecoveryAction(data: unknown) { return submit("/__test/supplier-recovery", data); }
