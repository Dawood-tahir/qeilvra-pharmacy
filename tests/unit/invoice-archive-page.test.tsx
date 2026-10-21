import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireStaff, from, range } = vi.hoisted(() => ({ requireStaff: vi.fn(), from: vi.fn(), range: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireStaff }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
import SalesPage from "@/app/(app)/sales/page";

beforeEach(() => {
  vi.resetAllMocks();
  requireStaff.mockResolvedValue({ id: "owner", role: "owner" });
  range.mockResolvedValue({ data: [], error: null });
  const query = { select: () => query, order: () => query, range };
  from.mockReturnValue(query);
});
afterEach(cleanup);

describe("invoice archive page integration", () => {
  it("offers the existing archive download on the Owner's invoices page", async () => {
    render(await SalesPage());
    expect(screen.getByRole("button", { name: "Download Invoice Archive" })).toBeEnabled();
    expect(from).toHaveBeenCalledWith("sales");
  });

  it("keeps the archive download hidden from salespeople", async () => {
    requireStaff.mockResolvedValue({ id: "staff", role: "salesperson" });
    render(await SalesPage());
    expect(screen.queryByRole("button", { name: "Download Invoice Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My sales" })).toBeInTheDocument();
  });
});
