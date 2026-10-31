export async function requireStaff() { const value=new URLSearchParams(location.search).get("role"); const role=value==="manager"?"manager":value==="salesperson"?"salesperson":"owner"; return {id:"fixture",fullName:role==="manager"?"Test Manager":"Test Owner",email:"fixture@example.test",role}; }
export const requireOwner=requireStaff;
export const requireOperationsManager=requireStaff;
