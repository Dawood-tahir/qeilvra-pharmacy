import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistorySearch } from "@/components/ui/live-route-form";
import { RecordSearchResults, RecordSearchScope } from "@/components/ui/record-search-results";
import { GlobalSearch } from "@/components/global-search";
import { textSearchFilter } from "@/lib/live-search";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  replace.mockReset();
  window.history.replaceState(null, "", "/");
});

it("filters a complete history locally on every keystroke and restores the list when cleared", async () => {
  vi.useFakeTimers();
  render(<RecordSearchScope complete>
    <HistorySearch action="/sales" query="" label="Search invoice number" />
    <RecordSearchResults empty={<p>No sales yet</p>} rows={[
      { id: "1", fields: ["RX-100"], content: <p>RX-100</p> },
      { id: "2", fields: ["AR-200"], content: <p>AR-200</p> },
      { id: "3", fields: ["QEI-300"], content: <p>QEI-300</p> },
    ]} />
  </RecordSearchScope>);
  const input = screen.getByLabelText("Search invoice number");
  const change = (value: string) => fireEvent.change(input, { target: { value } });

  change("r");
  expect(screen.getByText("RX-100")).toBeInTheDocument();
  expect(screen.getByText("AR-200")).toBeInTheDocument();
  expect(screen.queryByText("QEI-300")).not.toBeInTheDocument();
  change("rX");
  expect(screen.getByText("RX-100")).toBeInTheDocument();
  expect(screen.queryByText("AR-200")).not.toBeInTheDocument();
  change("RZ");
  expect(screen.getByText("No matching records found")).toBeInTheDocument();
  change("");
  expect(screen.getByText("QEI-300")).toBeInTheDocument();
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(replace).not.toHaveBeenCalled();
});

it("searches a paginated history from one letter and coalesces rapid edits within the current filters", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/expenses?from=2026-11-01&to=2026-11-21&page=2");
  render(<RecordSearchScope complete={false}>
    <HistorySearch action="/expenses" query="" label="Search expenses" filters={{ from: "2026-11-01", to: "2026-11-21" }} />
  </RecordSearchScope>);
  const input = screen.getByLabelText("Search expenses");
  fireEvent.change(input, { target: { value: "r" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(replace).toHaveBeenLastCalledWith("/expenses?from=2026-11-01&to=2026-11-21&q=r", { scroll: false });

  fireEvent.change(input, { target: { value: "re" } });
  fireEvent.change(input, { target: { value: "ren" } });
  fireEvent.change(input, { target: { value: "rent" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(replace).toHaveBeenCalledTimes(2);
  expect(replace).toHaveBeenLastCalledWith("/expenses?from=2026-11-01&to=2026-11-21&q=rent", { scroll: false });
});

it("global search reuses a complete response as the query narrows", async () => {
  vi.useFakeTimers();
  const fetchRecords = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "X-Search-Complete": "true" }),
    json: async () => [
      { id: "1", type: "invoice", title: "RX-001", href: "/sales/1", fields: ["RX-001"], subtitle: "Invoice" },
      { id: "2", type: "medicine", title: "Aspirin", href: "/medicines/2", fields: ["Aspirin"], subtitle: "Medicine" },
    ],
  });
  vi.stubGlobal("fetch", fetchRecords);
  render(<GlobalSearch />);
  const search = screen.getByLabelText("Global search");
  fireEvent.change(search, { target: { value: "R" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(fetchRecords).toHaveBeenCalledWith("/api/search?q=r", expect.anything());
  expect(screen.getByText("RX-001")).toBeInTheDocument();
  expect(screen.getByText("Aspirin")).toBeInTheDocument();

  fireEvent.change(search, { target: { value: "rX" } });
  expect(screen.getByText("RX-001")).toBeInTheDocument();
  expect(screen.queryByText("Aspirin")).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "rx2" } });
  expect(screen.getByText("No matching records found")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(fetchRecords).toHaveBeenCalledOnce();
});

it("quotes PostgREST values and preserves literal punctuation in SQL text matches", () => {
  expect(textSearchFilter('A(*), "%_\\', "reference")).toBe(String.raw`reference.imatch."A\\(\\*\\), \"%_\\\\"`);
});
