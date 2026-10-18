async function submit(path: string, body: unknown) { const result=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return result.json(); }
export async function saveGuidedMedicineAction(id: string|null,data: unknown,stock:unknown,key:string) { return submit("/__test/save",{id,data,stock,key}); }
export async function receiveStockAction(id:string,stock:unknown,key:string) { return submit("/__test/receive",{id,stock,key}); }
