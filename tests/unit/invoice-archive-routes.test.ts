// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, roleRpc, createArchiveBackend, runInvoiceArchive, currentVerifiedArchive, signedDownload, backend } = vi.hoisted(() => ({
  getUser: vi.fn(), roleRpc: vi.fn(), createArchiveBackend: vi.fn(), runInvoiceArchive: vi.fn(), currentVerifiedArchive: vi.fn(), signedDownload: vi.fn(), backend: { marker: "isolated archive backend" },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc: roleRpc }) }));
vi.mock("@/lib/invoice-archive/backend", () => ({ createArchiveBackend }));
vi.mock("@/lib/invoice-archive/worker", () => ({ runInvoiceArchive, currentVerifiedArchive }));
import { GET as cronGet, runtime as cronRuntime, maxDuration } from "@/app/api/cron/invoice-archive/route";
import { GET as ownerGet, runtime as downloadRuntime } from "@/app/api/invoices/archive/route";

const secret = "archive-test-secret-with-sufficient-length";
const cronRequest = (authorization: string | null = "Bearer " + secret) => new Request("https://qeilvra.test/api/cron/invoice-archive", { headers: authorization === null ? {} : { authorization } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", secret); vi.stubEnv("INVOICE_ARCHIVE_DRY_RUN", "true");
  vi.stubEnv("INVOICE_ARCHIVE_DELETE_ENABLED", "false");
  getUser.mockResolvedValue({ data: { user: { id: "owner-fixture" } }, error: null });
  roleRpc.mockResolvedValue({ data: "owner", error: null });
  createArchiveBackend.mockReturnValue({ backend, signedDownload });
  currentVerifiedArchive.mockResolvedValue({ object_key: "versions/1/verified.xlsx" });
  signedDownload.mockResolvedValue("https://storage.example.test/private/verified?token=short-lived");
  runInvoiceArchive.mockResolvedValue({ status: "dry_run_verified", deletedCount: 0, published: false });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("server-authenticated archive schedule", () => {
  it.each([undefined, "", "short-secret"])("fails closed before admin access when CRON_SECRET is %s", async value => {
    vi.stubEnv("CRON_SECRET", value);
    const response = await cronGet(cronRequest());
    expect(response.status).toBe(503); expect(createArchiveBackend).not.toHaveBeenCalled(); expect(runInvoiceArchive).not.toHaveBeenCalled();
  });

  it.each([null, "", "Bearer incorrect", "bearer " + secret, "Bearer " + secret + "x"])("rejects invalid machine credentials: %s", async authorization => {
    const response = await cronGet(cronRequest(authorization));
    expect(response.status).toBe(401); expect(createArchiveBackend).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each([undefined, "", "true", "FALSE", "0"])("forces non-publishing mode unless dry run is explicitly disabled: %s", async value => {
    vi.stubEnv("INVOICE_ARCHIVE_DRY_RUN", value);
    const response = await cronGet(cronRequest());
    expect(response.status).toBe(200); expect(runInvoiceArchive).toHaveBeenCalledWith(backend, { dryRun: true });
    expect(await response.json()).toEqual({ status: "dry_run_verified", deletedCount: 0, published: false });
  });

  it("passes explicit publication mode to a worker that still retains all source transactions", async () => {
    vi.stubEnv("INVOICE_ARCHIVE_DRY_RUN", "false"); await cronGet(cronRequest());
    expect(runInvoiceArchive).toHaveBeenCalledWith(backend, { dryRun: false });
  });

  it("requires an explicit server deletion gate independently of dry run", async () => {
    vi.stubEnv("INVOICE_ARCHIVE_DELETE_ENABLED", "true");
    await cronGet(cronRequest());
    expect(runInvoiceArchive).toHaveBeenCalledWith(backend, { dryRun: true, allowDeletion: true });
  });

  it("reports verification failure without exposing internal errors or private URLs", async () => {
    runInvoiceArchive.mockRejectedValue(new Error("private SQL with signed URL and token"));
    const response = await cronGet(cronRequest());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Invoice archive verification failed. Original records were retained." });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("handles backend configuration failure without exposing secrets", async () => {
    createArchiveBackend.mockImplementation(() => { throw new Error("service role secret unavailable"); });
    const response = await cronGet(cronRequest()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("service role secret");
  });

  it("uses the server runtime and a bounded Vercel execution budget", () => {
    expect(cronRuntime).toBe("nodejs"); expect(maxDuration).toBe(300);
  });
});

describe("Owner-only private verified archive download", () => {
  it.each([{ data: { user: null }, error: null }, { data: { user: { id: "stale" } }, error: { message: "invalid JWT" } }])("authenticates before opening private storage", async auth => {
    getUser.mockResolvedValue(auth);
    const response = await ownerGet(); expect(response.status).toBe(401);
    expect(roleRpc).not.toHaveBeenCalled(); expect(createArchiveBackend).not.toHaveBeenCalled();
  });

  it.each(["salesperson", "manager", "OWNER", null])("denies role %s before admin access", async role => {
    roleRpc.mockResolvedValue({ data: role, error: null });
    const response = await ownerGet(); expect(response.status).toBe(403); expect(roleRpc).toHaveBeenCalledWith("current_role");
    expect(createArchiveBackend).not.toHaveBeenCalled(); expect(signedDownload).not.toHaveBeenCalled();
  });

  it("fails closed if the current-role lookup fails", async () => {
    roleRpc.mockResolvedValue({ data: "owner", error: { message: "private database problem" } });
    expect((await ownerGet()).status).toBe(403); expect(createArchiveBackend).not.toHaveBeenCalled();
  });

  it("returns no download until an archive has been published and verified", async () => {
    currentVerifiedArchive.mockResolvedValue(null);
    expect((await ownerGet()).status).toBe(404); expect(signedDownload).not.toHaveBeenCalled();
  });

  it("verifies the current immutable object before preparing a short-lived Owner download", async () => {
    const response = await ownerGet();
    expect(response.status).toBe(200); expect(downloadRuntime).toBe("nodejs");
    expect(currentVerifiedArchive).toHaveBeenCalledWith(backend); expect(signedDownload).toHaveBeenCalledWith("versions/1/verified.xlsx");
    expect(currentVerifiedArchive.mock.invocationCallOrder[0]).toBeLessThan(signedDownload.mock.invocationCallOrder[0]);
    expect(await response.json()).toEqual({ url: "https://storage.example.test/private/verified?token=short-lived", filename: "Qeilvra_Invoices.xlsx" });
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["verify", "sign"])("does not expose a URL after %s failure", async stage => {
    (stage === "verify" ? currentVerifiedArchive : signedDownload).mockRejectedValue(new Error("private signed URL and internal error"));
    const response = await ownerGet(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private signed URL");
    if (stage === "verify") expect(signedDownload).not.toHaveBeenCalled();
  });
});
