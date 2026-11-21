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
  expect(rpc).toHaveBeenCalledWith("inventory_search", { p_query: "", p_limit: 50, p_offset: 0 });
});
it("filters preloaded stock instantly from one letter and restores it without another request", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const first = { ...medicine, packaging_status: "confirmed" as const };
  const second = { ...first, id: "second", name: "Aspirin", generic_name: "", sku: "ASP" };
  render(<PosWorkspace role="owner" initialMedicines={[first, second]} />);
  const search = screen.getByLabelText("Medicine search");
  fireEvent.change(search, { target: { value: "r" } });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.change(search, { target: { value: "aRa" } });
  expect(screen.getByRole("article", { name: "Paracetamol 500mg" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Aspirin 500mg" })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "no-hit" } });
  expect(screen.getByText("No matching records found")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(fetch).not.toHaveBeenCalled();
});
it("finds a medicine beyond the first database page before making any search request", async () => {
  const initial = Array.from({ length: 50 }, (_, index) => ({ ...medicine, id: String(index), name: "Aloe " + index, sku: "ALOE-" + index, barcode: "" }));
  rpc.mockResolvedValueOnce({ data: initial, error: null }).mockResolvedValueOnce({ data: [medicine], error: null });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(await PosPage());
  expect(screen.queryByText("Paracetamol 500mg")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Medicine search"), { target: { value: "c" } });
  expect(screen.getByRole("article", { name: "Paracetamol 500mg" })).toBeInTheDocument();
  expect(rpc).toHaveBeenLastCalledWith("inventory_search", { p_query: "", p_limit: 50, p_offset: 50 });
  expect(fetch).not.toHaveBeenCalled();
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
