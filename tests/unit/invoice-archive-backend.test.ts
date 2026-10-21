// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { createAdminClient, rpc, abortSignal, storageFrom, createSignedUrl, upload } = vi.hoisted(() => ({ createAdminClient: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn(), storageFrom: vi.fn(), createSignedUrl: vi.fn(), upload: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
import { createArchiveBackend } from "@/lib/invoice-archive/backend";

beforeEach(() => {
  vi.resetAllMocks();
  createAdminClient.mockReturnValue({ rpc, storage: { from: storageFrom } });
  storageFrom.mockReturnValue({ createSignedUrl, upload });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.example.test/private?token=test-only" }, error: null });
  upload.mockResolvedValue({ data: { path: "test.xlsx" }, error: null });
  abortSignal.mockResolvedValue({ data: { status: "ok" }, error: null }); rpc.mockReturnValue({ abortSignal });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); });
const successResponse = (bytes = new Uint8Array([1, 2, 3])) => new Response(bytes);

describe("private invoice archive storage adapter", () => {
  it("opens the dedicated bucket and bounds database request time", async () => {
    const { backend } = createArchiveBackend();
    expect(storageFrom).toHaveBeenCalledWith("invoice-archives");
    expect(await backend.rpc("invoice_archive_current", { p_test: true })).toEqual({ data: { status: "ok" }, error: null });
    expect(rpc).toHaveBeenCalledWith("invoice_archive_current", { p_test: true });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("uploads immutable objects without upserting existing archives", async () => {
    const { backend } = createArchiveBackend(), bytes = new Uint8Array([1, 2, 3]);
    await backend.write("versions/1/test.xlsx", bytes);
    expect(upload).toHaveBeenCalledWith("versions/1/test.xlsx", bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", cacheControl: "0", upsert: false });
  });

  it("reports upload failure without exposing SDK details", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "private token and storage URL" } });
    await expect(createArchiveBackend().backend.write("test.xlsx", new Uint8Array([1]))).rejects.toThrow(/^Private archive upload failed\.$/);
  });

  it("reads signed private content as a bounded stream without response caching", async () => {
    const first = new Uint8Array([1, 2]), last = new Uint8Array([3, 4]);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(first); controller.enqueue(last); controller.close(); } });
    vi.mocked(fetch).mockResolvedValue(new Response(stream));
    expect(await createArchiveBackend().backend.read("versions/1/test.xlsx", 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(createSignedUrl).toHaveBeenCalledWith("versions/1/test.xlsx", 60);
    expect(fetch).toHaveBeenCalledWith("https://storage.example.test/private?token=test-only", { cache: "no-store", signal: expect.any(AbortSignal) });
  });

  it("does not fetch if private signing fails", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "private token" } });
    await expect(createArchiveBackend().backend.read("test.xlsx", 3)).rejects.toThrow(/^Private archive could not be opened\.$/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([new Response("denied", { status: 403 }), new Response(null), new Response(new Uint8Array([1]), { headers: { "content-length": "100" } })])("rejects unsuccessful, missing, or declared oversized content", async response => {
    vi.mocked(fetch).mockResolvedValue(response);
    await expect(createArchiveBackend().backend.read("test.xlsx", 3)).rejects.toThrow(/^Private archive download failed or exceeded its size limit\.$/);
  });

  it("cancels an oversized stream even when Content-Length is absent", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); }, cancel });
    vi.mocked(fetch).mockResolvedValue(new Response(stream));
    await expect(createArchiveBackend().backend.read("test.xlsx", 3)).rejects.toThrow(/^Private archive exceeds its size limit\.$/);
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });

  it("rejects a lying Content-Length using actual streamed bytes", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "1" } }));
    await expect(createArchiveBackend().backend.read("test.xlsx", 3)).rejects.toThrow(/^Private archive exceeds its size limit\.$/);
  });

  it("releases the stream lock if transport fails halfway through", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (++pulled === 1) controller.enqueue(new Uint8Array([1])); else controller.error(new Error("network interrupted")); } });
    vi.mocked(fetch).mockResolvedValue(new Response(stream));
    await expect(createArchiveBackend().backend.read("test.xlsx", 3)).rejects.toThrow("network interrupted"); expect(stream.locked).toBe(false);
  });

  it("allows the exact byte limit", async () => {
    vi.mocked(fetch).mockResolvedValue(successResponse());
    expect(await createArchiveBackend().backend.read("test.xlsx", 3)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("prepares a 60-second download under the stable workbook filename", async () => {
    expect(await createArchiveBackend().signedDownload("versions/1/test.xlsx")).toBe("https://storage.example.test/private?token=test-only");
    expect(createSignedUrl).toHaveBeenCalledWith("versions/1/test.xlsx", 60, { download: "Qeilvra_Invoices.xlsx" });
  });

  it.each([{ data: null, error: null }, { data: { signedUrl: "" }, error: null }, { data: null, error: { message: "private SDK detail" } }])("does not expose signing failure internals", async signingResult => {
    createSignedUrl.mockResolvedValue(signingResult);
    await expect(createArchiveBackend().signedDownload("test.xlsx")).rejects.toThrow(/^Private archive download could not be prepared\.$/);
  });
});
