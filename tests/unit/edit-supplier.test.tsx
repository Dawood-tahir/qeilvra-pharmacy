import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), success: vi.fn() }));
vi.mock("@/app/(app)/suppliers/actions", () => ({ updateSupplierAction: mocks.update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
import { EditSupplier } from "@/components/suppliers/edit-supplier";

const supplier = { id: "50000000-0000-4000-8000-000000000005", name: "City Pharmacy", contact_person: "Ahmed", phone: "03001234567", email: "orders@example.com", address: "12 Main Road\nFloor 2", city: "Lahore", tax_number: "NTN-001 / A" };
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function open() { render(<EditSupplier supplier={supplier} />); fireEvent.click(screen.getByRole("button", { name: "Edit Supplier" })); }

describe("supplier information editor", () => {
  it("prefills all seven existing values and leaves missing information blank", () => {
    open();
    expect(screen.getByLabelText("Supplier / Company Name *")).toHaveValue(supplier.name);
    for (const value of [supplier.contact_person, supplier.phone, supplier.email, supplier.city, supplier.tax_number]) expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    expect(screen.getByLabelText("Full Business Address")).toHaveValue(supplier.address);
    cleanup();
    render(<EditSupplier supplier={{ ...supplier, contact_person: null, phone: null, email: null, address: null, city: null, tax_number: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Supplier" }));
    expect(screen.getByLabelText("City")).toHaveValue("");
  });
  it("cancels without writing and warns before discarding unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Karachi" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByLabelText("City")).toHaveValue("Karachi");
    expect(mocks.update).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("City")).not.toBeInTheDocument();
  });
  it("validates company, phone and email without clearing input or submitting", () => {
    open();
    fireEvent.change(screen.getByLabelText("Supplier / Company Name *"), { target: { value: " " } });
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "test@gmail" } });
    fireEvent.change(screen.getByLabelText("Primary Phone Number"), { target: { value: "call me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(screen.getByLabelText("Supplier / Company Name *")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email Address")).toHaveValue("test@gmail");
    expect(screen.getByText(/Enter a complete email address/)).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("disables duplicate saves and closes only after the database confirms success", async () => {
    let resolve!: (value: { ok: true }) => void;
    mocks.update.mockReturnValue(new Promise(done => { resolve = done; }));
    open();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Karachi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByLabelText("City").closest("form")!);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
    await waitFor(() => expect(screen.queryByLabelText("City")).not.toBeInTheDocument());
    expect(mocks.update).toHaveBeenCalledWith(supplier.id, expect.objectContaining({ city: "Karachi" }));
    expect(mocks.success).toHaveBeenCalledWith("Supplier information updated successfully.");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("retains edits after a failed save and permits retry", async () => {
    mocks.update.mockResolvedValueOnce({ ok: false, error: "Supplier update failed." }).mockResolvedValueOnce({ ok: true });
    open();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Karachi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByText("Supplier update failed.");
    expect(screen.getByLabelText("City")).toHaveValue("Karachi");
    expect(mocks.success).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  });
});
