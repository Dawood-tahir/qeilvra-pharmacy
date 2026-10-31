import { beforeEach, describe, expect, it, vi } from "vitest";
const { requireOwner, createAdminClient, invite, remove, insertProfile, insertRole, readRole, updateRole, updateResult, createClient } = vi.hoisted(() => ({ requireOwner: vi.fn(), createAdminClient: vi.fn(), invite: vi.fn(), remove: vi.fn(), insertProfile: vi.fn(), insertRole: vi.fn(), readRole: vi.fn(), updateRole: vi.fn(), updateResult: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { inviteSalespersonAction, setStaffRoleAction } from "@/app/(app)/users/actions";
const ownerId = "10000000-0000-4000-8000-000000000001";
const staffId = "30000000-0000-4000-8000-000000000003";
const form = (values: Record<string, string>) => { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, value); return result; };
beforeEach(() => {
  vi.resetAllMocks();
  requireOwner.mockResolvedValue({ id: ownerId, role: "owner" });
  invite.mockResolvedValue({ data: { user: { id: staffId } }, error: null });
  insertProfile.mockResolvedValue({ error: null }); insertRole.mockResolvedValue({ error: null });
  createAdminClient.mockReturnValue({ auth: { admin: { inviteUserByEmail: invite, deleteUser: remove } }, from: (table: string) => ({ insert: table === "profiles" ? insertProfile : insertRole }) });
  readRole.mockResolvedValue({ data: { role: "salesperson" }, error: null });
  updateResult.mockResolvedValue({ data: { user_id: staffId }, error: null });
  const mutation = { eq: () => mutation, in: () => mutation, select: () => mutation, single: updateResult };
  updateRole.mockReturnValue(mutation);
  const query = { select: () => query, eq: () => query, single: readRole, update: updateRole };
  createClient.mockResolvedValue({ from: () => query });
});
describe("Owner-controlled staff roles", () => {
  it.each(["manager", "salesperson"])("creates a %s invitation through the existing verification flow", async role => {
    expect(await inviteSalespersonAction(form({ full_name: "New staff", email: "new@example.test", role }))).toMatchObject({ ok: true });
    expect(invite).toHaveBeenCalledWith("new@example.test", expect.objectContaining({ redirectTo: expect.stringContaining("/auth/callback?next=/update-password") }));
    expect(insertRole).toHaveBeenCalledWith({ user_id: staffId, role });
    expect(remove).not.toHaveBeenCalled();
  });
  it("rejects a forged Owner invitation before admin access", async () => {
    expect(await inviteSalespersonAction(form({ full_name: "Forged owner", email: "forged@example.test", role: "owner" }))).toMatchObject({ ok: false });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("denies a Manager before inviting or assigning roles", async () => {
    requireOwner.mockRejectedValue(new Error("Owner permission required"));
    await expect(inviteSalespersonAction(form({ full_name: "Denied", email: "denied@example.test", role: "manager" }))).rejects.toThrow("Owner permission required");
    await expect(setStaffRoleAction(form({ id: staffId, role: "manager" }))).rejects.toThrow("Owner permission required");
    expect(createAdminClient).not.toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
  });
  it("allows Owner to assign Manager to an existing Salesperson", async () => {
    expect(await setStaffRoleAction(form({ id: staffId, role: "manager" }))).toMatchObject({ ok: true });
    expect(updateRole).toHaveBeenCalledWith({ role: "manager" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("keeps the existing Owner out of the staff-role editor", async () => {
    expect(await setStaffRoleAction(form({ id: ownerId, role: "manager" }))).toMatchObject({ ok: false });
    expect(createClient).not.toHaveBeenCalled();
    readRole.mockResolvedValue({ data: { role: "owner" } });
    expect(await setStaffRoleAction(form({ id: staffId, role: "manager" }))).toMatchObject({ ok: false });
    expect(updateRole).not.toHaveBeenCalled();
  });
});
