import { timingSafeEqual } from "node:crypto";
import { createArchiveBackend } from "@/lib/invoice-archive/backend";
import { runInvoiceArchive } from "@/lib/invoice-archive/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET, received = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return Response.json({ error: "Archive scheduler is not configured." }, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(received);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const { backend } = createArchiveBackend();
    const result = await runInvoiceArchive(backend, { dryRun: process.env.INVOICE_ARCHIVE_DRY_RUN !== "false",
      ...(process.env.INVOICE_ARCHIVE_DELETE_ENABLED === "true" ? { allowDeletion: true } : {}) });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "Invoice archive verification failed. Original records were retained." }, { status: 503, headers });
  }
}
