import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StockPage from "@/app/(app)/stock/page";
import { createClient } from "@/lib/supabase/server";
import type { StockBatch } from "@/components/stock/stock-batch-list";

vi.mock("@/lib/auth", () => ({ requireOperationsManager: async () => ({ id: "staff" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/stock-disposition-data", () => ({ loadDispositionHistory: async () => ({}) }));
vi.mock("@/components/stock/disposition-history", () => ({ DispositionHistory: () => null }));
vi.mock("@/components/stock/stock-actions", () => ({ StockActions: () => null }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/");
});

function batch(id: number, batchNumber: string, name = "Aloe", genericName: string | null = null, sku = "ALOE"): StockBatch {
  return {
    id: String(id).padStart(4, "0"),
    batch_number: batchNumber,
    expiry_date: "2030-01-01",
    quantity_on_hand: 5,
    purchase_cost: "10.00",
    is_quarantined: false,
    supplier_id: null,
    suppliers: null,
    medicines: { id: "medicine-" + id, name, generic_name: genericName, sku, base_unit: "tablet", strength: null },
  };
}

function mockBatches(batches: StockBatch[]) {
  const readBatches = vi.fn((after: string, limit: number) => Promise.resolve({
    data: batches.filter((row) => row.id > after).slice(0, limit),
    error: null,
  }));
  const from = vi.fn((table: string) => {
    if (table === "suppliers") return { select: () => ({ order: async () => ({ data: [], error: null }) }) };
    expect(table).toBe("medicine_batches");
    let after = "";
    let limit = 0;
    const query = {
      select: () => query,
      order: () => query,
      limit: (value: number) => { limit = value; return query; },
      gt: (column: string, value: string) => { expect(column).toBe("id"); after = value; return query; },
      then: (resolve: (result: { data: StockBatch[]; error: null }) => void) => readBatches(after, limit).then(resolve),
    };
    return query;
  });
  vi.mocked(createClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createClient>>);
  return readBatches;
}

it("filters the complete batch list on every keystroke and restores it when cleared", async () => {
  const batches = Array.from({ length: 1000 }, (_, i) => batch(i + 1, "ALOE-" + (i + 1)));
  batches.push(batch(1001, "ZZ-78", "Brufen", "Ibuprofen", "ZZ-900"), batch(1002, "RX-36"));
  const readBatches = mockBatches(batches);
  render(await StockPage({ searchParams: Promise.resolve({}) }));
  const search = screen.getByLabelText("Search medicine or batch number");
  const table = within(screen.getByRole("table"));
  const type = (value: string) => fireEvent.change(search, { target: { value } });

  expect(screen.getByText("1002 batches · Page 1")).toBeInTheDocument();
  expect(table.queryByText("ZZ-78")).not.toBeInTheDocument();

  type("r");
  expect(screen.getByText("2 batches · Page 1")).toBeInTheDocument();
  expect(table.getByText("ZZ-78")).toBeInTheDocument();
  expect(table.getByText("RX-36")).toBeInTheDocument();

  type("rU");
  expect(table.getByText("ZZ-78")).toBeInTheDocument();
  expect(table.queryByText("RX-36")).not.toBeInTheDocument();

  for (const query of ["pROfe", "zz-90", "ZZ-7"]) {
    type(query);
    expect(table.getByText("ZZ-78")).toBeInTheDocument();
  }

  type("zz-999");
  expect(screen.getByText("No matching records found")).toBeInTheDocument();

  type("");
  expect(screen.queryByText("No matching records found")).not.toBeInTheDocument();
  expect(screen.getByText("1002 batches · Page 1")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Next"));
  expect(screen.getByText("1002 batches · Page 2")).toBeInTheDocument();

  expect(readBatches).toHaveBeenCalledTimes(2);
  expect(readBatches).toHaveBeenLastCalledWith("1000", 1000);
});

it("keeps the existing query parameter and Search button usable", async () => {
  window.history.replaceState(null, "", "/stock?q=rX");
  mockBatches([batch(1, "RX-36"), batch(2, "ZZ-78")]);
  render(await StockPage({ searchParams: Promise.resolve({ q: "rX" }) }));
  const search = screen.getByRole("textbox", { name: "Search medicine or batch number" });
  expect(search).toHaveValue("rX");
  expect(screen.getByRole("cell", { name: "RX-36" })).toBeInTheDocument();

  fireEvent.change(search, { target: { value: "zz" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(new URLSearchParams(window.location.search).get("q")).toBe("zz");
  expect(screen.getByRole("cell", { name: "ZZ-78" })).toBeInTheDocument();
});
