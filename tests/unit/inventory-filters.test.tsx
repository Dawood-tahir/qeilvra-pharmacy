import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InventoryList } from "@/components/medicines/inventory-list";
import type { InventoryBatchExpiry } from "@/lib/inventory-filters";
import type { StockMedicine } from "@/lib/medicine-units";

function medicine(id: string, name: string, available_quantity: number): StockMedicine {
  return {
    id, name, sku: id, available_quantity, selling_price: 10, base_unit: "tablet",
    stock_status: available_quantity === 0 ? "out_of_stock" : "in_stock",
    packaging_status: "confirmed", units: [],
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("combines live Inventory search with expiry and stock filters while preserving sorting", () => {
  window.history.replaceState(null, "", "/medicines");
  const catalog = [
    medicine("PAN1", "Panadol", 0),
    medicine("PAN2", "Panamax", 12),
    medicine("ASA", "Aspirin", 0),
    medicine("NH1", "No batches", 5),
  ];
  const batchExpiries: InventoryBatchExpiry[] = [
    { medicine_id: "PAN1", earliest_expired: "2026-11-21", nearest_unexpired: null },
    { medicine_id: "PAN2", earliest_expired: "2026-11-20", nearest_unexpired: "2026-11-22" },
    { medicine_id: "ASA", earliest_expired: null, nearest_unexpired: "2026-11-23" },
  ];
  render(<InventoryList catalog={catalog} batchExpiries={batchExpiries} initialQuery="" initialPage={1} filter="all" sort="name" manage={false} />);
  const search = screen.getByRole("textbox", { name: "Search medicines" });
  const table = within(screen.getByRole("table"));
  const select = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Inventory filters" })).getByRole("button", { name }));
  };

  select("Out of Stock");
  expect(table.getByText("Panadol")).toBeInTheDocument();
  expect(table.getByText("Aspirin")).toBeInTheDocument();
  expect(table.queryByText("Panamax")).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: "pAN" } });
  expect(table.getByText("Panadol")).toBeInTheDocument();
  expect(table.queryByText("Aspirin")).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "" } });
  expect(table.getByText("Aspirin")).toBeInTheDocument();
  expect(table.queryByText("Panamax")).not.toBeInTheDocument();

  select("Expired");
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "expiry" } });
  expect(table.getAllByRole("row")[1]).toHaveTextContent("Panamax");
  expect(table.getByText("Panadol")).toBeInTheDocument();
  expect(table.queryByText("Aspirin")).not.toBeInTheDocument();

  select("Not Expired");
  expect(table.getByText("Panamax")).toBeInTheDocument();
  expect(table.getByText("Aspirin")).toBeInTheDocument();
  expect(table.queryByText("Panadol")).not.toBeInTheDocument();
  expect(table.queryByText("No batches")).not.toBeInTheDocument();
  expect(new URLSearchParams(location.search).get("sort")).toBe("expiry");
  expect(new URLSearchParams(location.search).get("filter")).toBe("not_expired");

  select("All Medicines");
  expect(table.getByText("No batches")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Add New Medicine" })).not.toBeInTheDocument();
});
