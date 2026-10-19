import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { getClaims, createServerClient } = vi.hoisted(() => ({ getClaims: vi.fn(), createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@/lib/env", () => ({ isSupabaseConfigured: true, getPublicSupabaseEnv: () => ({ url: "https://supabase.example.test", publishableKey: "public-test-key" }) }));
import { updateSession } from "@/lib/supabase/proxy";
beforeEach(() => {
  vi.resetAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { sub: "staff" } }, error: null });
  createServerClient.mockReturnValue({ auth: { getClaims } });
});
describe("verified session proxy", () => {
  it("allows the inactive sign-in error to render without a redirect loop", async () => {
    const response = await updateSession(new NextRequest("https://qeilvra.test/login?error=inactive"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("keeps normal signed-in login navigation", async () => {
    const response = await updateSession(new NextRequest("https://qeilvra.test/login"));
    expect(response.headers.get("location")).toBe("https://qeilvra.test/dashboard");
  });
  it("rejects invalid claims at protected API boundaries", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "invalid signature" } });
    const response = await updateSession(new NextRequest("https://qeilvra.test/api/medicines/search"));
    expect(response.status).toBe(401); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("invalid signature");
  });
  it("preserves refreshed cookies and no-store headers on redirects", async () => {
    createServerClient.mockImplementation((_url, _key, options) => {
      getClaims.mockImplementation(async () => { options.cookies.setAll([{ name: "refreshed-session", value: "test-only", options: { httpOnly: true, path: "/" } }]); return { data: { claims: { sub: "staff" } } }; });
      return { auth: { getClaims } };
    });
    const response = await updateSession(new NextRequest("https://qeilvra.test/login"));
    expect(response.cookies.get("refreshed-session")?.value).toBe("test-only");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
