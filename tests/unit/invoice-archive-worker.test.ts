// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { currentVerifiedArchive, runInvoiceArchive, verifySavedArchive, type ArchiveBackend } from "@/lib/invoice-archive/worker";
import { buildWorkbook, inspectWorkbook, type ArchiveInvoice } from "@/lib/invoice-archive/workbook";

const id = (number: number) => "20000000-0000-4000-8000-" + String(number).padStart(12, "0");
const lease = id(999), cutoff = "2026-10-06T02:00:00.000Z", runAt = "2026-10-21T02:00:00.000Z";
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function invoice(number = 1, completedAt = "2026-10-01T12:34:56.123456+05:00"): ArchiveInvoice {
  const saleId = id(number);
  const payload = JSON.stringify({
    sale: { id: saleId, completed_at: completedAt, status: "completed", invoice_number: "SAFE-" + number, subtotal: "100.00", discount: "5.00", extra_charge_amount: "2.00", net_total: "97.00" },
    items: [{ id: id(100 + number), sale_id: saleId, medicine_id: id(500), quantity: "2.000", unit_price: "50.00", line_total: "100.00" }],
    payments: [{ id: id(200 + number), sale_id: saleId, kind: "sale", method: "card", amount: "97.00" }],
    costs: [{ id: id(300 + number), sale_item_id: id(100 + number), batch_id: id(501), quantity: "2.000", unit_cost: "20.00" }],
    returns: [], return_items: [], return_allocations: [], stock_movements: [], audit_events: [], cashier: null,
  });
  return { saleId, completedAt, payload, sourceHash: digest(payload) };
}
type Version = { generation: number; object_key: string; sha256: string; size_bytes: number; invoice_count: number };
type RpcResult = { data: unknown; error: unknown };
type Batch = { status: string; lease: string; fence: number; expected_generation: number; generation: number; cutoff: string; dry_run: boolean; has_more: boolean; candidates: { sale_id: string; completed_at: string; payload_text: string; source_sha256: string }[] };

/** Exercises actual XLSX bytes while isolating every database/storage effect. */
function fakeBackend(invoices = [invoice()], initial: Version | null = null) {
  const objects = new Map<string, Uint8Array>(), calls: { name: string; args?: Record<string, unknown> }[] = [];
  const source = structuredClone(invoices);
  const activeLineIds = new Set(invoices.map(row => row.saleId));
  const pruneResults = new Map<string, RpcResult>();
  let current = initial;
  const committed = new Map<string, RpcResult>();
  const options = {
    dryRun: false, status: "claimed", upload: "normal", failHeartbeat: 0, heartbeatCount: 0,
    deletionEnabled: false, failPrune: false, losePruneResponse: false, pruneBacklog: false,
    loseCommitResponse: false, failCommit: false, mutateBatch: (batch: Batch) => { void batch; }, mutateCommitVersion: (version: Version) => { void version; },
  };
  const backend: ArchiveBackend = {
    rpc: vi.fn(async (name, args): Promise<RpcResult> => {
      calls.push({ name, args });
      if (name === "invoice_archive_current") return { data: current, error: null };
      if (name === "invoice_archive_claim") return { data: options.status === "claimed" ? { status: "claimed", lease, fence: 1, expected_generation: current?.generation ?? 0, next_generation: (current?.generation ?? 0) + 1, cutoff, dry_run: options.dryRun, current_version: current } : { status: options.status }, error: null };
      if (name === "invoice_archive_heartbeat") {
        options.heartbeatCount++;
        return options.failHeartbeat === options.heartbeatCount ? { data: null, error: { message: "lease expired" } } : { data: { status: "ok" }, error: null };
      }
      if (name === "invoice_archive_batch") {
        const batch: Batch = { status: invoices.length ? "ready" : "empty", lease, fence: 1, expected_generation: current?.generation ?? 0, generation: (current?.generation ?? 0) + 1, cutoff, dry_run: options.dryRun, has_more: false,
          candidates: invoices.map(row => ({ sale_id: row.saleId, completed_at: row.completedAt, payload_text: row.payload, source_sha256: row.sourceHash })) };
        options.mutateBatch(batch);
        return { data: batch, error: null };
      }
      if (name === "invoice_archive_commit") {
        if (options.failCommit) return { data: null, error: { message: "private database error" } };
        const key = String(args!.p_object_key), replay = committed.get(key);
        if (replay) return replay;
        const manifest = args!.p_manifest as { sale_id: string; source_sha256: string }[];
        current = { generation: Number(args!.p_expected_generation) + 1, object_key: String(args!.p_object_key), sha256: String(args!.p_sha256), size_bytes: Number(args!.p_size_bytes), invoice_count: manifest.length };
        options.mutateCommitVersion(current);
        const result = { data: { status: "committed", generation: current.generation, deleted_count: 0, current_version: current }, error: null };
        committed.set(key, result);
        if (options.loseCommitResponse) return { data: null, error: { message: "response lost after commit" } };
        return result;
      }
      if (name === "invoice_archive_prune") {
        if (options.failPrune) return { data: null, error: { message: "prune interrupted before commit" } };
        const replay = pruneResults.get(String(args!.p_operation_id));
        if (replay) return replay;
        if (!options.deletionEnabled) return { data: { status: "deletion_disabled", deleted_count: 0, invoices_pruned: 0 }, error: null };
        if (current?.sha256 !== args!.p_sha256 || current?.generation !== args!.p_generation) return { data: null, error: { message: "version mismatch" } };
        const count = activeLineIds.size; activeLineIds.clear();
        const result = { data: { status: "pruned", deleted_count: count, invoices_pruned: count, has_more: options.pruneBacklog && count>0 }, error: null };
        pruneResults.set(String(args!.p_operation_id), result);
        if (options.losePruneResponse) return { data: null, error: { message: "lost response after prune commit" } };
        return result;
      }
      if (name === "invoice_archive_release") return { data: { status: "released" }, error: null };
      throw new Error("Unexpected RPC: " + name);
    }),
    read: vi.fn(async (key, maxBytes) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Object not found");
      if (bytes.length > maxBytes) throw new Error("Object too large");
      return bytes.slice();
    }),
    write: vi.fn(async (key, bytes) => {
      if (options.upload === "missing") throw new Error("Upload failed before write");
      objects.set(key, options.upload === "corrupt" ? bytes.slice(0, -1) : bytes.slice());
      if (options.upload === "lost_response") throw new Error("Upload response lost");
    }),
  };
  return { backend, objects, calls, options, source, activeLineIds, get current() { return current; } };
}
const run = (backend: ArchiveBackend, options: Parameters<typeof runInvoiceArchive>[1] = {}) => runInvoiceArchive(backend, { now: () => Date.parse(runAt), dryRun: false, ...options });
const callsTo = (fake: ReturnType<typeof fakeBackend>, name: string) => fake.calls.filter(call => call.name === name);

beforeEach(() => { vi.clearAllMocks(); });
describe("invoice archive worker with isolated storage and real Excel workbooks", () => {
  it("publishes only independently read-back verified bytes and never deletes source transactions", async () => {
    const fake = fakeBackend(), before = structuredClone(fake.source);
    const result = await run(fake.backend);
    expect(result).toMatchObject({ status: "verified", batches: 1, invoicesProcessed: 1, generation: 1, deletedCount: 0 });
    expect(fake.current).not.toBeNull();
    const stored = await inspectWorkbook(fake.objects.get(fake.current!.object_key)!);
    expect(stored.invoices).toEqual(before);
    expect(fake.source).toEqual(before);
    expect(fake.calls.map(call => call.name)).toEqual(["invoice_archive_claim", "invoice_archive_heartbeat", "invoice_archive_batch", "invoice_archive_heartbeat", "invoice_archive_heartbeat", "invoice_archive_commit", "invoice_archive_release"]);
    expect(fake.backend.read).toHaveBeenCalledWith(fake.current!.object_key, expect.any(Number));
    expect(fake.current!.object_key).toMatch(/^versions\/1\//);
  });

  it.each(["disabled", "busy"])("does not touch storage when the scheduler is %s", async status => {
    const fake = fakeBackend(); fake.options.status = status;
    expect(await run(fake.backend)).toEqual({ status, batches: 0, deletedCount: 0 });
    expect(fake.backend.read).not.toHaveBeenCalled(); expect(fake.backend.write).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(1);
  });

  it("lets a concurrent busy run exit while the lease holder uploads and publishes once", async () => {
    const fake = fakeBackend();
    let continueUpload!: () => void, notifyUpload!: () => void;
    const pendingUpload = new Promise<void>(resolve => { continueUpload = resolve; });
    const uploadStarted = new Promise<void>(resolve => { notifyUpload = resolve; });
    vi.mocked(fake.backend.write).mockImplementationOnce(async (key, bytes) => {
      fake.options.status = "busy"; fake.objects.set(key, bytes.slice()); notifyUpload(); await pendingUpload;
    });
    const first = run(fake.backend); await uploadStarted;
    expect(await run(fake.backend)).toMatchObject({ status: "busy", batches: 0, deletedCount: 0 });
    continueUpload(); expect(await first).toMatchObject({ status: "verified", batches: 1 });
    expect(fake.backend.write).toHaveBeenCalledTimes(1); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(1);
  });

  it("verifies dry-run uploads without publishing any pointer or touching invoices", async () => {
    const fake = fakeBackend(); fake.options.dryRun = true;
    expect(await run(fake.backend, { dryRun: true })).toMatchObject({ status: "dry_run_verified", batches: 1, deletedCount: 0, published: false });
    expect(callsTo(fake, "invoice_archive_claim")[0].args).toEqual({ p_force_dry_run: true });
    expect(fake.current).toBeNull(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
    expect([...fake.objects.keys()][0]).toMatch(/^dry-runs\//);
  });

  it("defaults to a forced dry run when no caller option is supplied", async () => {
    const fake = fakeBackend(); fake.options.dryRun = true;
    expect(await runInvoiceArchive(fake.backend)).toMatchObject({ status: "dry_run_verified", deletedCount: 0, published: false });
    expect(callsTo(fake, "invoice_archive_claim")[0].args).toEqual({ p_force_dry_run: true });
  });

  it("blocks a database claim that ignores the caller's forced dry run", async () => {
    const fake = fakeBackend();
    await expect(runInvoiceArchive(fake.backend)).rejects.toThrow();
    expect(fake.backend.write).not.toHaveBeenCalled(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
  });

  it("treats an empty eligible batch as up to date", async () => {
    const fake = fakeBackend([]);
    expect(await run(fake.backend)).toMatchObject({ status: "up_to_date", batches: 0, deletedCount: 0 });
    expect(fake.backend.write).not.toHaveBeenCalled(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
  });

  it.each(["missing", "corrupt"])("blocks publication after %s upload and safely retries next run", async upload => {
    const fake = fakeBackend(); fake.options.upload = upload;
    await expect(run(fake.backend)).rejects.toThrow();
    expect(fake.current).toBeNull(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
    expect(callsTo(fake, "invoice_archive_release").at(-1)?.args?.p_error).toBe("Archive verification or publication failed. Source records retained.");
    fake.options.upload = "normal";
    expect(await run(fake.backend)).toMatchObject({ status: "verified", deletedCount: 0 });
    expect((await inspectWorkbook(fake.objects.get(fake.current!.object_key)!)).invoiceCount).toBe(1);
  });

  it("recovers when storage saved the workbook but the upload response was lost", async () => {
    const fake = fakeBackend(); fake.options.upload = "lost_response";
    expect(await run(fake.backend)).toMatchObject({ status: "verified", deletedCount: 0 });
    expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(1);
  });

  it("replays exactly the same publication request after a lost commit response", async () => {
    const fake = fakeBackend(); fake.options.loseCommitResponse = true;
    expect(await run(fake.backend)).toMatchObject({ status: "verified", generation: 1, deletedCount: 0 });
    const commits = callsTo(fake, "invoice_archive_commit");
    expect(commits).toHaveLength(2); expect(commits[0].args).toEqual(commits[1].args);
    expect((await inspectWorkbook(fake.objects.get(fake.current!.object_key)!)).revisionCount).toBe(1);
  });

  it("leaves an uncommitted verified object recoverable after publication failure", async () => {
    const fake = fakeBackend(); fake.options.failCommit = true;
    await expect(run(fake.backend)).rejects.toThrow("Source records retained");
    expect(fake.current).toBeNull(); expect(fake.objects.size).toBe(1); expect(fake.source).toEqual([invoice()]);
    fake.options.failCommit = false;
    expect(await run(fake.backend)).toMatchObject({ status: "verified", generation: 1 });
  });

  it.each(["generation", "size_bytes", "invoice_count", "object_key", "sha256"])("rejects malformed published workbook %s metadata", async field => {
    const fake = fakeBackend();
    fake.options.mutateCommitVersion = version => {
      Object.assign(version, { [field]: field === "object_key" ? `versions/1/${lease}-${"b".repeat(64)}.xlsx` : field === "sha256" ? "b".repeat(64) : 99 });
    };
    await expect(run(fake.backend)).rejects.toThrow("Published archive metadata mismatch");
    expect(callsTo(fake, "invoice_archive_release").at(-1)?.args?.p_error).toBe("Archive verification or publication failed. Source records retained.");
    expect(fake.source).toEqual([invoice()]);
  });

  it("preserves every previous invoice and revision when appending a new batch", async () => {
    const previous = await buildWorkbook(null, [invoice()], { generation: 1, previousSha256: null, createdAt: runAt });
    const initial: Version = { generation: 1, object_key: `versions/1/${lease}-${previous.sha256}.xlsx`, sha256: previous.sha256, size_bytes: previous.bytes.length, invoice_count: 1 };
    const fake = fakeBackend([invoice(2)], initial); fake.objects.set(initial.object_key, previous.bytes);
    expect(await run(fake.backend)).toMatchObject({ status: "verified", generation: 2 });
    const inspected = await inspectWorkbook(fake.objects.get(fake.current!.object_key)!);
    expect(inspected.invoices).toEqual([invoice(), invoice(2)]); expect(inspected.revisions).toHaveLength(2);
    expect(inspected.previousSha256).toBe(previous.sha256); expect(fake.objects.get(initial.object_key)).toEqual(previous.bytes);
    expect(callsTo(fake, "invoice_archive_commit")[0].args?.p_manifest).toHaveLength(2);
  });

  it("does not duplicate snapshots when a later run retries the same source invoices", async () => {
    const fake = fakeBackend();
    await run(fake.backend); await run(fake.backend);
    const stored = await inspectWorkbook(fake.objects.get(fake.current!.object_key)!);
    expect(stored.generation).toBe(2); expect(stored.invoiceCount).toBe(1); expect(stored.revisionCount).toBe(1);
    expect(stored.invoices).toEqual([invoice()]); expect(fake.source).toEqual([invoice()]);
  });

  it("blocks appending when the existing current workbook is corrupt", async () => {
    const fake = fakeBackend([invoice()], { generation: 1, object_key: `versions/1/${lease}-${"a".repeat(64)}.xlsx`, sha256: "a".repeat(64), size_bytes: 3, invoice_count: 1 });
    fake.objects.set(fake.current!.object_key, new Uint8Array([1, 2, 3]));
    await expect(run(fake.backend)).rejects.toThrow("integrity verification failed");
    expect(fake.backend.write).not.toHaveBeenCalled(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
  });

  it.each(["lease", "fence", "expected_generation", "generation", "dry_run"])("rejects a batch with a stale or invalid %s", async field => {
    const fake = fakeBackend();
    fake.options.mutateBatch = batch => { Object.assign(batch, { [field]: field === "lease" ? id(998) : field === "dry_run" ? true : 99 }); };
    await expect(run(fake.backend)).rejects.toThrow("fence, generation or cutoff mismatch");
    expect(fake.backend.write).not.toHaveBeenCalled(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
  });

  it("rejects a batch whose retention cutoff differs from the claimed snapshot", async () => {
    const fake = fakeBackend(); fake.options.mutateBatch = batch => { batch.cutoff = "2026-10-07T02:00:00.000Z"; };
    await expect(run(fake.backend)).rejects.toThrow("cutoff mismatch");
    expect(fake.backend.write).not.toHaveBeenCalled();
  });

  it("rejects a ready batch with no candidates instead of silently reporting success", async () => {
    const fake = fakeBackend([]); fake.options.mutateBatch = batch => { batch.status = "ready"; };
    await expect(run(fake.backend)).rejects.toThrow("batch status mismatch");
    expect(fake.backend.write).not.toHaveBeenCalled();
  });

  it.each([cutoff, "2026-10-07T02:00:00Z", "invalid"])("retains an invoice at or beyond the strict retention boundary: %s", async completedAt => {
    const fake = fakeBackend([invoice(1, completedAt)]);
    await expect(run(fake.backend)).rejects.toThrow("retention boundary");
    expect(fake.backend.write).not.toHaveBeenCalled(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
  });

  it("stops before publication when a lease expires after upload verification", async () => {
    const fake = fakeBackend(); fake.options.failHeartbeat = 3;
    await expect(run(fake.backend)).rejects.toThrow("Source records retained");
    expect(fake.objects.size).toBe(1); expect(fake.current).toBeNull(); expect(callsTo(fake, "invoice_archive_commit")).toHaveLength(0);
  });

  it.each([{ batchSize: 0 }, { batchSize: 101 }, { maxBatches: 0 }, { maxRunMs: 0 }, { maxRunMs: NaN }, { maxRunMs: Infinity }])("rejects invalid execution limits before claiming a lease", async options => {
    const fake = fakeBackend(); await expect(run(fake.backend, options)).rejects.toThrow("Invalid archive execution limits"); expect(fake.calls).toHaveLength(0);
  });

  it("stops at its batch limit while preserving a valid current workbook", async () => {
    const fake = fakeBackend(); fake.options.mutateBatch = batch => { batch.has_more = true; };
    expect(await run(fake.backend, { maxBatches: 1 })).toMatchObject({ status: "partial", batches: 1, resumeRequired: true });
    expect(callsTo(fake, "invoice_archive_batch")).toHaveLength(1);
  });

  it("processes more than four batches when runtime capacity is available", async () => {
    const fake = fakeBackend(); let number = 0;
    fake.options.mutateBatch = batch => {
      const next = invoice(++number);
      batch.candidates = [{ sale_id: next.saleId, completed_at: next.completedAt, payload_text: next.payload, source_sha256: next.sourceHash }];
      batch.has_more = number<6;
    };
    expect(await run(fake.backend)).toMatchObject({ batches: 6, invoicesProcessed: 6, resumeRequired: false });
    expect(fake.current!.invoice_count).toBe(6);
  });

  it("reports that a resume is required when its execution budget expires before a batch", async () => {
    const fake = fakeBackend(); let clock = 0;
    expect(await run(fake.backend, { maxRunMs: 1, now: () => Date.parse(runAt) + clock++ })).toMatchObject({ status: "partial", batches: 0, resumeRequired: true, deletedCount: 0 });
    expect(callsTo(fake, "invoice_archive_batch")).toHaveLength(0); expect(fake.backend.write).not.toHaveBeenCalled();
  });
});

describe("verified archive pruning gates and recovery", () => {
  it("never calls pruning without the explicit server gate", async () => {
    const fake = fakeBackend(); fake.options.deletionEnabled = true;
    expect(await run(fake.backend)).toMatchObject({ deletedCount: 0, deletionStatus: "server_disabled" });
    expect(callsTo(fake, "invoice_archive_prune")).toHaveLength(0);
    expect(fake.activeLineIds.size).toBe(1);
  });

  it("never prunes in a dry run even if both deletion gates are requested", async () => {
    const fake = fakeBackend(); fake.options.dryRun = true; fake.options.deletionEnabled = true;
    await run(fake.backend, { dryRun: true, allowDeletion: true });
    expect(callsTo(fake, "invoice_archive_prune")).toHaveLength(0);
    expect(fake.activeLineIds.size).toBe(1);
  });

  it("respects the disabled database deletion gate", async () => {
    const fake = fakeBackend();
    expect(await run(fake.backend, { allowDeletion: true })).toMatchObject({ deletedCount: 0, deletionStatus: "deletion_disabled" });
    expect(fake.activeLineIds.size).toBe(1);
  });

  it("verifies the committed workbook again before pruning original details", async () => {
    const fake = fakeBackend(); fake.options.deletionEnabled = true;
    expect(await run(fake.backend, { allowDeletion: true })).toMatchObject({ deletedCount: 1, deletionStatus: "pruned" });
    const prune = callsTo(fake, "invoice_archive_prune")[0];
    expect(prune.args).toMatchObject({ p_generation: 1, p_sha256: fake.current!.sha256 });
    expect(fake.backend.read).toHaveBeenCalledTimes(2);
    const pruneIndex = fake.calls.indexOf(prune);
    expect(vi.mocked(fake.backend.rpc).mock.invocationCallOrder[pruneIndex]).toBeGreaterThan(vi.mocked(fake.backend.read).mock.invocationCallOrder.at(-1)!);
    expect(fake.activeLineIds.size).toBe(0); expect(fake.source).toEqual([invoice()]);
  });

  it("replays the exact operation after a lost deletion response", async () => {
    const fake = fakeBackend(); fake.options.deletionEnabled = true; fake.options.losePruneResponse = true;
    expect(await run(fake.backend, { allowDeletion: true })).toMatchObject({ deletedCount: 1 });
    const prunes = callsTo(fake, "invoice_archive_prune");
    expect(prunes).toHaveLength(2); expect(prunes[0].args).toEqual(prunes[1].args);
    expect(fake.activeLineIds.size).toBe(0);
  });

  it("resumes deletion of an already published archive after process interruption", async () => {
    const fake = fakeBackend(); fake.options.deletionEnabled = true; fake.options.failPrune = true;
    await expect(run(fake.backend, { allowDeletion: true })).rejects.toThrow();
    expect(fake.current).not.toBeNull(); expect(fake.activeLineIds.size).toBe(1);
    fake.options.failPrune = false;
    fake.options.mutateBatch = batch => { batch.candidates = []; batch.status = "empty"; };
    const writes = vi.mocked(fake.backend.write).mock.calls.length;
    expect(await run(fake.backend, { allowDeletion: true })).toMatchObject({ status: "up_to_date", deletedCount: 1 });
    expect(fake.backend.write).toHaveBeenCalledTimes(writes);
    expect(fake.activeLineIds.size).toBe(0);
  });

  it("blocks pruning if the committed workbook becomes corrupt before the final readback", async () => {
    const fake = fakeBackend(); fake.options.deletionEnabled = true;
    let reads = 0;
    vi.mocked(fake.backend.read).mockImplementation(async key => {
      const bytes = fake.objects.get(key)!;
      return ++reads === 1 ? bytes.slice() : bytes.slice(0, -1);
    });
    await expect(run(fake.backend, { allowDeletion: true })).rejects.toThrow("integrity verification failed");
    expect(callsTo(fake, "invoice_archive_prune")).toHaveLength(0); expect(fake.activeLineIds.size).toBe(1);
  });

  it("drains a deletion backlog without republishing the same invoices", async () => {
    const fake = fakeBackend(); fake.options.deletionEnabled = true; fake.options.pruneBacklog = true;
    expect(await run(fake.backend, { allowDeletion: true, batchSize: 1 })).toMatchObject({ deletedCount: 1, resumeRequired: false });
    expect(callsTo(fake, "invoice_archive_prune")).toHaveLength(2);
    expect(fake.backend.write).toHaveBeenCalledTimes(1);
  });

  it("reports remaining deletion work when its bounded sweep cannot finish", async () => {
    const fake = fakeBackend(); fake.options.deletionEnabled = true; fake.options.pruneBacklog = true;
    expect(await run(fake.backend, { allowDeletion: true, batchSize: 1, maxBatches: 1 })).toMatchObject({ deletedCount: 1, status: "partial", resumeRequired: true });
    expect(callsTo(fake, "invoice_archive_prune")).toHaveLength(1);
  });
});

describe("verified archive download lookup", () => {
  it("reports no published archive without touching storage", async () => {
    const fake = fakeBackend(); expect(await currentVerifiedArchive(fake.backend)).toBeNull(); expect(fake.backend.read).not.toHaveBeenCalled();
  });
  it("validates saved bytes and invoice count before exposing current metadata", async () => {
    const fake = fakeBackend(); await run(fake.backend);
    expect(await currentVerifiedArchive(fake.backend)).toEqual(fake.current);
    await expect(verifySavedArchive(fake.backend, { ...fake.current!, invoice_count: 2 })).rejects.toThrow("invoice count");
    await expect(verifySavedArchive(fake.backend, { ...fake.current!, size_bytes: fake.current!.size_bytes + 1 })).rejects.toThrow("integrity verification failed");
  });
  it("blocks oversized stored metadata before downloading", async () => {
    const fake = fakeBackend(); await run(fake.backend); vi.mocked(fake.backend.read).mockClear();
    await expect(verifySavedArchive(fake.backend, fake.current!, { maxBytes: 1 })).rejects.toThrow("size limit");
    expect(fake.backend.read).not.toHaveBeenCalled();
  });
});
