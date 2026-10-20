import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { refresh, router } = vi.hoisted(() => { const refresh = vi.fn(); return { refresh, router: { refresh } }; });
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { ProfileRefresh } from "@/components/suppliers/profile-refresh";

beforeEach(() => { vi.useFakeTimers(); refresh.mockClear(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("does not poll a visible profile or refetch on immediate focus events", async () => {
  render(<ProfileRefresh />);
  fireEvent.focus(window); fireEvent(document, new Event("visibilitychange"));
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(refresh).not.toHaveBeenCalled();
});
it("refreshes once on return after a minute and preserves manual refresh", async () => {
  render(<ProfileRefresh />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  fireEvent.focus(window); fireEvent(document, new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledOnce();
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(refresh).toHaveBeenCalledTimes(2);
});
