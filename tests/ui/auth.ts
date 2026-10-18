export async function requireStaff() { return {id:"fixture",fullName:"Test Owner",role:new URLSearchParams(location.search).get("role")==="salesperson"?"salesperson":"owner"}; }
export const requireOwner=requireStaff;
