export type AppRole = "owner" | "manager" | "salesperson";

export function isAppRole(role: unknown): role is AppRole {
  return role === "owner" || role === "manager" || role === "salesperson";
}

export function canManageOperations(role: AppRole) {
  return role === "owner" || role === "manager";
}
