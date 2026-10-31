import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, single, redirect } = vi.hoisted(() => ({ getUser: vi.fn(), single: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }) }));
import { getCurrentStaff, requireOperationsManager, requireOwner } from "@/lib/auth";
import { canManageOperations, isAppRole } from "@/lib/permissions";
beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "manager", email: "manager@example.test" } } });
  single.mockResolvedValue({ data: { full_name: "Manager", is_active: true, user_roles: { role: "manager" } } });
  redirect.mockImplementation((url: string) => { throw new Error("Redirect: " + url); });
});
describe("Manager identity and role boundaries", () => {
  it("recognizes Manager without granting Owner identity", async () => {
    expect(isAppRole("manager")).toBe(true);
    expect(canManageOperations("manager")).toBe(true);
    expect(await getCurrentStaff()).toMatchObject({ role: "manager", id: "manager" });
    expect(await requireOperationsManager()).toMatchObject({ role: "manager" });
    await expect(requireOwner()).rejects.toThrow("Redirect: /dashboard?error=forbidden");
  });
  it.each(["salesperson", "owner"])("preserves the existing %s boundary", async role => {
    single.mockResolvedValue({ data: { full_name: "Existing", is_active: true, user_roles: [{ role }] } });
    expect(await getCurrentStaff()).toMatchObject({ role });
    if (role === "owner") expect(await requireOwner()).toMatchObject({ role });
    else await expect(requireOperationsManager()).rejects.toThrow("Redirect: /dashboard?error=forbidden");
  });
  it.each([{ is_active: false, role: "manager" }, { is_active: true, role: "admin" }, { is_active: true, role: "MANAGER" }])("rejects inactive or unknown roles: %j", async profile => {
    single.mockResolvedValue({ data: { full_name: "Denied", is_active: profile.is_active, user_roles: { role: profile.role } } });
    expect(await getCurrentStaff()).toBeNull();
    await expect(requireOperationsManager()).rejects.toThrow("Redirect: /login?error=inactive");
  });
});
