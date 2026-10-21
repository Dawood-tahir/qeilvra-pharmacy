import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ARCHIVE_BUCKET, ARCHIVE_FILENAME, type ArchiveBackend } from "./worker";

export function createArchiveBackend() {
  const admin = createAdminClient(), bucket = admin.storage.from(ARCHIVE_BUCKET);
  const backend: ArchiveBackend = {
    rpc: (name, args) => Promise.resolve(admin.rpc(name, args).abortSignal(AbortSignal.timeout(45_000))),
    async read(key, maxBytes) {
      // A short-lived server-side URL allows a bounded streaming read. Never
      // allocate an unbounded response Blob before checking the stored bytes.
      const { data, error } = await bucket.createSignedUrl(key, 60);
      if (error || !data?.signedUrl) throw new Error("Private archive could not be opened.");
      const response = await fetch(data.signedUrl, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
      if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("Private archive download failed or exceeded its size limit.");
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          total += value.byteLength;
          if (total > maxBytes) throw new Error("Private archive exceeds its size limit.");
          chunks.push(value);
        }
      } catch (failure) { await reader.cancel().catch(() => undefined); throw failure; }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    },
    async write(key, bytes) {
      const { error } = await bucket.upload(key, bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", cacheControl: "0", upsert: false });
      if (error) throw new Error("Private archive upload failed.");
    },
  };
  return {
    backend,
    async signedDownload(key: string) {
      const { data, error } = await bucket.createSignedUrl(key, 60, { download: ARCHIVE_FILENAME });
      if (error || !data?.signedUrl) throw new Error("Private archive download could not be prepared.");
      return data.signedUrl;
    },
  };
}
