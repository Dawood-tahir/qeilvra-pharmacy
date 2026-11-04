"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, LoaderCircle, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { updateSupplierAction } from "@/app/(app)/suppliers/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Supplier } from "@/lib/supplier-profile";
import { supplierInformationErrors, supplierInformationFields, supplierInformationSchema, type SupplierInformationErrors, type SupplierInformationField, type SupplierInformationValues } from "@/lib/supplier-information";

type EditableSupplier = Pick<Supplier, "id" | SupplierInformationField>;

export function EditSupplier({ supplier }: { supplier: EditableSupplier }) {
  const [open, setOpen] = useState(false);
  return <><Button type="button" variant="outline" size="sm" className="border-blue-400 text-blue-600 shadow-sm shadow-blue-600/15 hover:border-blue-600 hover:bg-blue-50" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Pencil aria-hidden="true" />Edit</Button>{open && <SupplierInformationForm key={supplier.id} supplier={supplier} onClose={() => setOpen(false)} />}</>;
}

function SupplierInformationForm({ supplier, onClose }: { supplier: EditableSupplier; onClose: () => void }) {
  const router = useRouter();
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const [initial] = useState(() => Object.fromEntries(supplierInformationFields.map(field => [field, supplier[field] ?? ""])) as SupplierInformationValues);
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<SupplierInformationErrors>({});
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const dirty = supplierInformationFields.some(field => values[field] !== initial[field]);

  useEffect(() => {
    // React autofocus runs before the native dialog opens; focus after showModal.
    formRef.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function close() {
    if (saving.current || pending) return;
    if (!dirty || window.confirm("Discard your unsaved supplier changes?")) onClose();
  }
  function showErrors(errors: SupplierInformationErrors) {
    setFieldErrors(errors);
    const field = supplierInformationFields.find(field => errors[field]);
    if (field) formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || pending) return;
    setError("");
    const parsed = supplierInformationSchema.safeParse(values);
    if (!parsed.success) { showErrors(supplierInformationErrors(parsed.error)); return; }
    setFieldErrors({});
    saving.current = true;
    startTransition(async () => {
      try {
        const result = await updateSupplierAction(supplier.id, values);
        if (!result.ok) {
          setError(result.error);
          if (result.fieldErrors) showErrors(result.fieldErrors);
          return;
        }
        toast.success("Supplier information updated successfully.");
        router.refresh();
        onClose();
      } catch {
        setError("The save could not be confirmed. Your entries are kept. Please try again.");
      } finally { saving.current = false; }
    });
  }
  function input(field: SupplierInformationField, label: string, options: { type?: string; maximum: number; autoComplete?: string; full?: boolean; multiline?: boolean }) {
    const id = `${prefix}-${field}`;
    const props = {
      id, name: field, value: values[field], maxLength: options.maximum,
      autoComplete: options.autoComplete,
      "aria-invalid": Boolean(fieldErrors[field]),
      "aria-describedby": fieldErrors[field] ? `${id}-error` : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setValues(current => ({ ...current, [field]: event.target.value }));
        setFieldErrors(current => ({ ...current, [field]: undefined }));
      },
    };
    return <div className={options.full ? "min-w-0 sm:col-span-2" : "min-w-0"}><label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-[#071b45]">{label}{field === "name" && " *"}</label>{options.multiline ? <textarea {...props} rows={3} className="q-input min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /> : <Input {...props} type={options.type ?? "text"} required={field === "name"} autoFocus={field === "name"} />}{fieldErrors[field] && <p id={`${id}-error`} className="mt-1 text-sm text-red-700" role="alert">{fieldErrors[field]}</p>}</div>;
  }
  return <Dialog label="Edit Supplier Information" onClose={close} busy={pending} className="q-supplier-editor max-w-2xl">
    <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Building2 aria-hidden="true" className="size-5" /></span><div className="min-w-0"><h2 className="text-xl font-extrabold text-[#071b45]">Edit Supplier Information</h2><p className="mt-1 text-sm text-slate-500">Update supplier contact and business details.</p></div></div><Button type="button" size="icon" variant="ghost" aria-label="Close supplier editor" disabled={pending} onClick={close}><X aria-hidden="true" /></Button></div>
    <form ref={formRef} onSubmit={save} noValidate className="mt-5">
      <fieldset disabled={pending} aria-busy={pending} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {input("name", "Supplier / Company Name", { maximum: 160, autoComplete: "organization", full: true })}
        {input("contact_person", "Contact Person Name", { maximum: 120, autoComplete: "name" })}
        {input("phone", "Primary Phone Number", { maximum: 40, type: "tel", autoComplete: "tel" })}
        {input("email", "Email Address", { maximum: 254, type: "email", autoComplete: "email" })}
        {input("address", "Full Business Address", { maximum: 500, autoComplete: "street-address", full: true, multiline: true })}
        {input("city", "City", { maximum: 120, autoComplete: "address-level2" })}
        {input("tax_number", "Tax Registration Number", { maximum: 80 })}
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4"><Button type="button" variant="outline" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" disabled={pending}>{pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}{pending ? "Saving..." : "Save Changes"}</Button></div>
    </form>
  </Dialog>;
}
