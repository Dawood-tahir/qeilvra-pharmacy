import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { medicine } from "../ui/data";
const { requireStaff, createClient, rpc } = vi.hoisted(() => ({ requireStaff: vi.fn(), createClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireStaff }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import PosPage from "@/app/(app)/pos/page";
import { PosWorkspace } from "@/components/pos/pos-workspace";

beforeEach(() => { vi.useFakeTimers(); requireStaff.mockResolvedValue({ id: "staff", role: "salesperson" }); createClient.mockResolvedValue({ rpc }); rpc.mockResolvedValue({ data: [medicine], error: null }); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("renders server medicine results after verified staff access without an initial API round trip", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(await PosPage());
  expect(screen.getByRole("article", { name: "Paracetamol 500mg" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(fetch).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("inventory_search", { p_query: "", p_limit: 30 });
});
it("still searches and reloads current stock when a search is cleared", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [medicine] }); vi.stubGlobal("fetch", fetch);
  render(<PosWorkspace role="owner" initialMedicines={[{ ...medicine, packaging_status: "confirmed" }]} />);
  fireEvent.change(screen.getByLabelText("Medicine search"), { target: { value: "para" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(fetch.mock.calls[0][0]).toContain("q=para&limit=30");
  fireEvent.change(screen.getByLabelText("Medicine search"), { target: { value: "" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetch.mock.calls[1][0]).toContain("q=&limit=30");
});
it("keeps the API fallback when initial medicine loading fails", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [medicine] }); vi.stubGlobal("fetch", fetch);
  render(await PosPage());
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetch).toHaveBeenCalledOnce();
});
it("does not query stock before staff authorization succeeds", async () => {
  requireStaff.mockRejectedValueOnce(new Error("Unauthorized"));
  await expect(PosPage()).rejects.toThrow("Unauthorized");
  expect(createClient).not.toHaveBeenCalled();
});
