import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { financeRange } from "@/lib/financial-analytics";
import { financialFixture } from "../ui/financial-data";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { FinancialAnalytics } from "@/components/dashboard/financial-analytics";

const range = financeRange("today");
const data = financialFixture(range);
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("coalesces focus, visibility, online and timer refreshes while one request is running", async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(r => { resolve = r; })); vi.stubGlobal("fetch", fetch);
  render(<FinancialAnalytics initialData={data} initialRange={range} />);
  fireEvent.focus(window); fireEvent(document, new Event("visibilitychange")); fireEvent(window, new Event("online"));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
  await act(async () => { resolve(Response.json(data)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not let an automatic refresh cancel the user's period selection", async () => {
  const fetch = vi.fn().mockReturnValue(new Promise(() => {})); vi.stubGlobal("fetch", fetch);
  render(<FinancialAnalytics initialData={data} initialRange={range} />);
  fireEvent.click(screen.getByRole("button", { name: "This Week" }));
  fireEvent.focus(window); fireEvent(document, new Event("visibilitychange"));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toContain("period=week");
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
});
it("retains the last figures on refresh failure and permits retry", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("Connection failed")); vi.stubGlobal("fetch", fetch);
  render(<FinancialAnalytics initialData={data} initialRange={range} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
  expect(screen.getByRole("alert").textContent).toContain("last loaded figures remain");
  expect(screen.getByLabelText("Financial totals")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
  expect(fetch).toHaveBeenCalledTimes(2);
});
