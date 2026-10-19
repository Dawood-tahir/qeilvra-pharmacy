import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrintButton } from "@/components/sales/print-button";

beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); vi.spyOn(window, "print").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(500); }); };
describe("receipt print retries", () => {
  it("prints once through Strict Mode, remount and refresh state", async () => {
    const first = render(<StrictMode><PrintButton autoPrint saleId="invoice-one" /></StrictMode>);
    await settle(); expect(window.print).toHaveBeenCalledTimes(1);
    first.unmount(); render(<PrintButton autoPrint saleId="invoice-one" />);
    await settle(); expect(window.print).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Print invoice" }));
    expect(window.print).toHaveBeenCalledTimes(2);
  });
  it("OFF only prints on an explicit manual click", async () => {
    render(<PrintButton saleId="invoice-two" />); await settle(); expect(window.print).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Print invoice" })); expect(window.print).toHaveBeenCalledOnce();
  });
  it("a manual print before the timer prevents a second automatic print", async () => {
    render(<PrintButton autoPrint saleId="invoice-three" />);
    fireEvent.click(screen.getByRole("button", { name: "Print invoice" })); await settle();
    expect(window.print).toHaveBeenCalledOnce();
  });
  it("prints a different confirmed invoice when the component is reused", async () => {
    const view = render(<PrintButton autoPrint saleId="invoice-four" />); await settle();
    view.rerender(<PrintButton autoPrint saleId="invoice-five" />); await settle();
    expect(window.print).toHaveBeenCalledTimes(2);
  });
});
