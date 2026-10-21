import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { buildWorkbook, inspectWorkbook, DEFAULT_ARCHIVE_LIMITS } from "./workbook";
import type { ArchiveLimits, ArchiveManifestEntry } from "./types";

export const ARCHIVE_BUCKET = "invoice-archives";
export const ARCHIVE_FILENAME = "Qeilvra_Invoices.xlsx";
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const versionSchema = z.object({
  generation: counter, object_key: z.string().regex(/^versions\/[1-9]\d*\/[0-9a-f-]{36}-[0-9a-f]{64}\.xlsx$/),
  sha256: hash, size_bytes: counter.positive(), invoice_count: counter.positive(),
});
type Version = z.infer<typeof versionSchema>;
const claimSchema = z.object({
  status: z.literal("claimed"), lease: z.uuid(), fence: counter, expected_generation: counter,
  next_generation: counter, cutoff: z.string(), dry_run: z.boolean(), current_version: versionSchema.nullable(),
});
const batchSchema = z.object({
  status: z.enum(["ready", "empty"]), lease: z.uuid(), fence: counter, expected_generation: counter, generation: counter,
  cutoff: z.string(), dry_run: z.boolean(), has_more: z.boolean(),
  candidates: z.array(z.object({ sale_id: z.uuid(), completed_at: z.string(), payload_text: z.string(), source_sha256: hash })),
});

/** Storage verification, publication and transactional pruning are separate so
 * interruptions can resume from a verified committed workbook. */
export interface ArchiveBackend {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  read(key: string, maxBytes: number): Promise<Uint8Array>;
  write(key: string, bytes: Uint8Array): Promise<void>;
}
export type ArchiveRunOptions = {
  dryRun?: boolean; allowDeletion?: boolean; batchSize?: number; maxBatches?: number; maxRunMs?: number;
  limits?: Partial<ArchiveLimits>; now?: () => number;
};

async function rpc(backend: ArchiveBackend, name: string, args?: Record<string, unknown>) {
  const result = await backend.rpc(name, args);
  if (result.error) throw new Error(`Archive state request failed (${name}). Source records retained.`);
  return result.data;
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function verifySavedArchive(backend: ArchiveBackend, version: Version, limits?: Partial<ArchiveLimits>, manifest?: ArchiveManifestEntry[]) {
  const maxBytes = limits?.maxBytes ?? DEFAULT_ARCHIVE_LIMITS.maxBytes;
  if (version.size_bytes > maxBytes) throw new Error("Archive exceeds the verified workbook size limit.");
  const bytes = await backend.read(version.object_key, maxBytes);
  if (bytes.byteLength !== version.size_bytes || digest(bytes) !== version.sha256) throw new Error("Saved archive integrity verification failed.");
  const inspection = await inspectWorkbook(bytes, { sha256: version.sha256, generation: version.generation, manifest, limits });
  if (inspection.invoiceCount !== version.invoice_count) throw new Error("Saved archive invoice count does not match its verified manifest.");
  return bytes;
}

export async function runInvoiceArchive(backend: ArchiveBackend, options: ArchiveRunOptions = {}) {
  const now = options.now ?? Date.now, started = now();
  // Bound each RPC step; daily throughput follows runtime capacity rather than
  // an assumed pharmacy invoice count. Callers can request a smaller batch cap.
  const batchSize = options.batchSize ?? 100, maxBatches = options.maxBatches ?? Number.MAX_SAFE_INTEGER, budget = options.maxRunMs ?? 200_000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100 || !Number.isSafeInteger(maxBatches) || maxBatches < 1 || !Number.isFinite(budget) || budget < 1) throw new Error("Invalid archive execution limits.");
  const forceDryRun = options.dryRun ?? true;
  const result = await rpc(backend, "invoice_archive_claim", { p_force_dry_run: forceDryRun });
  if (result && typeof result === "object" && "status" in result && ["disabled", "busy"].includes(String(result.status))) return { status: result.status, batches: 0, deletedCount: 0 };
  const claim = claimSchema.parse(result), leaseArgs = { p_lease: claim.lease, p_fence: claim.fence };
  let current = claim.current_version, batches = 0, archived = 0, hasMore = true, deletedCount = 0;
  let deletionStatus = "server_disabled";
  let pruneHasMore = false, prunePasses = 0;
  async function pruneVerified(version: Version) {
    if (!options.allowDeletion || claim.dry_run) return;
    const args = { ...leaseArgs, p_generation: version.generation, p_sha256: version.sha256, p_operation_id: randomUUID(), p_limit: batchSize };
    let raw: unknown;
    try { raw = await rpc(backend, "invoice_archive_prune", args); }
    catch { raw = await rpc(backend, "invoice_archive_prune", args); }
    const pruned = z.object({ status: z.enum(["pruned", "deletion_disabled"]), deleted_count: counter, invoices_pruned: counter, has_more: z.boolean().default(false) }).parse(raw);
    if (pruned.status === "deletion_disabled" && (pruned.deleted_count || pruned.invoices_pruned)) throw new Error("Disabled deletion returned a nonzero count.");
    deletedCount += pruned.deleted_count; deletionStatus = pruned.status;
    pruneHasMore = pruned.has_more; prunePasses++;
  }
  try {
    if ((forceDryRun && !claim.dry_run) || claim.expected_generation !== (current?.generation ?? 0) || claim.next_generation !== claim.expected_generation + 1 || !Number.isFinite(Date.parse(claim.cutoff))) throw new Error("Archive claim mode, generation or cutoff mismatch.");
    let previous = current ? await verifySavedArchive(backend, current, options.limits) : null;
    // Recover a publication that succeeded before its process was interrupted.
    // The persisted object is downloaded/verified above before any prune RPC.
    if (current) await pruneVerified(current);
    while (batches < maxBatches && now() - started < budget) {
      await rpc(backend, "invoice_archive_heartbeat", leaseArgs);
      const batch = batchSchema.parse(await rpc(backend, "invoice_archive_batch", { ...leaseArgs, p_limit: batchSize }));
      if (batch.lease !== claim.lease || batch.fence !== claim.fence || batch.expected_generation !== (current?.generation ?? 0) || batch.generation !== batch.expected_generation + 1 || batch.dry_run !== claim.dry_run || batch.cutoff !== claim.cutoff) throw new Error("Archive batch fence, generation or cutoff mismatch.");
      if ((batch.status === "empty") !== (batch.candidates.length === 0)) throw new Error("Archive batch status mismatch.");
      if (!batch.candidates.length) { hasMore = false; break; }
      const cutoff = Date.parse(batch.cutoff);
      if (!Number.isFinite(cutoff) || batch.candidates.some(row => !Number.isFinite(Date.parse(row.completed_at)) || Date.parse(row.completed_at) >= cutoff)) throw new Error("Archive batch contains an invoice outside its retention boundary.");
      const workbook = await buildWorkbook(previous, batch.candidates.map(row => ({ saleId: row.sale_id, completedAt: row.completed_at, sourceHash: row.source_sha256, payload: row.payload_text })), {
        generation: batch.generation, previousSha256: current?.sha256 ?? null, createdAt: new Date(now()).toISOString(), limits: options.limits,
      });
      await rpc(backend, "invoice_archive_heartbeat", leaseArgs);
      const objectKey = claim.dry_run ? `dry-runs/${claim.lease}/${workbook.sha256}.xlsx` : `versions/${batch.generation}/${claim.lease}-${workbook.sha256}.xlsx`;
      // An interrupted upload can have succeeded remotely. Only a complete,
      // independently downloaded and verified object can proceed either way.
      try { await backend.write(objectKey, workbook.bytes); } catch { /* Readback below is authoritative. */ }
      const saved = await backend.read(objectKey, options.limits?.maxBytes ?? DEFAULT_ARCHIVE_LIMITS.maxBytes);
      if (saved.byteLength !== workbook.bytes.byteLength || digest(saved) !== workbook.sha256) throw new Error("Uploaded workbook failed readback verification.");
      await inspectWorkbook(saved, { sha256: workbook.sha256, generation: batch.generation, manifest: workbook.manifest, limits: options.limits });
      await rpc(backend, "invoice_archive_heartbeat", leaseArgs);
      if (claim.dry_run) {
        await rpc(backend, "invoice_archive_release", { ...leaseArgs, p_error: null });
        return { status: "dry_run_verified", batches: 1, invoices: workbook.invoiceCount, deletedCount: 0, published: false };
      }
      const commitArgs = { ...leaseArgs, p_expected_generation: batch.expected_generation, p_object_key: objectKey, p_sha256: workbook.sha256, p_size_bytes: saved.byteLength,
        p_manifest: workbook.manifest.map(entry => ({ sale_id: entry.saleId, source_sha256: entry.sourceHash })) };
      let committed: unknown;
      try { committed = await rpc(backend, "invoice_archive_commit", commitArgs); }
      catch { committed = await rpc(backend, "invoice_archive_commit", commitArgs); } // Exact idempotent replay after a lost response.
      const published = z.object({ status: z.literal("committed"), generation: counter, deleted_count: z.literal(0), current_version: versionSchema }).parse(committed);
      if (published.generation !== batch.generation || published.current_version.generation !== batch.generation || published.current_version.sha256 !== workbook.sha256 || published.current_version.object_key !== objectKey || published.current_version.size_bytes !== saved.byteLength || published.current_version.invoice_count !== workbook.invoiceCount) throw new Error("Published archive metadata mismatch.");
      current = published.current_version; previous = saved; archived += batch.candidates.length; batches++; hasMore = batch.has_more;
      if (options.allowDeletion) {
        await verifySavedArchive(backend, current, options.limits, workbook.manifest);
        await pruneVerified(current);
      }
      if (!batch.has_more) break;
    }
    while (current && pruneHasMore && prunePasses < maxBatches && now() - started < budget) {
      await rpc(backend, "invoice_archive_heartbeat", leaseArgs);
      await verifySavedArchive(backend, current, options.limits);
      await pruneVerified(current);
    }
    await rpc(backend, "invoice_archive_release", { ...leaseArgs, p_error: null });
    return { status: hasMore || pruneHasMore ? "partial" : batches ? "verified" : "up_to_date", batches, invoicesProcessed: archived, generation: current?.generation ?? 0, resumeRequired: hasMore || pruneHasMore, deletedCount, deletionStatus };
  } catch (error) {
    // Do not persist potentially sensitive SDK errors, URLs or source payloads.
    await rpc(backend, "invoice_archive_release", { ...leaseArgs, p_error: "Archive verification or publication failed. Source records retained." }).catch(() => undefined);
    throw error;
  }
}

export async function currentVerifiedArchive(backend: ArchiveBackend, limits?: Partial<ArchiveLimits>) {
  const raw = await rpc(backend, "invoice_archive_current");
  if (raw == null) return null;
  const version = versionSchema.parse(raw);
  await verifySavedArchive(backend, version, limits);
  return version;
}
