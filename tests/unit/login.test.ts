import { beforeEach, describe, expect, it, vi } from "vitest";
const { signIn, getUser, single, signOut, redirect } = vi.hoisted(() => ({ signIn: vi.fn(), getUser: vi.fn(), single: vi.fn(), signOut: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithPassword: signIn, getUser, signOut }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }) }));
vi.mock("next/navigation", () => ({ redirect }));
import { loginAction } from "@/app/(auth)/actions";
beforeEach(() => {
  vi.resetAllMocks();
  signIn.mockResolvedValue({ error: null }); getUser.mockResolvedValue({ data: { user: { id: "staff" } } }); single.mockResolvedValue({ data: { is_active: true } });
  redirect.mockImplementation((url: string) => { throw new Error("Redirect: " + url); });
});
describe("existing sign-in flow with mocked Auth", () => {
  it.each(["owner", "salesperson"])("signs in an active %s using verified Auth and profile state", async (role) => {
    const form = new FormData(); form.set("email", role + "@example.test"); form.set("password", "fixture-only-password");
    await expect(loginAction(form)).rejects.toThrow("Redirect: /dashboard");
    expect(getUser).toHaveBeenCalledTimes(1); expect(single).toHaveBeenCalledTimes(1);
  });
  it("signs out an inactive account", async () => {
    single.mockResolvedValue({ data: { is_active: false } });
    const form = new FormData(); form.set("email", "inactive@example.test"); form.set("password", "fixture-only-password");
    await expect(loginAction(form)).rejects.toThrow("Redirect: /login?error=inactive");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
