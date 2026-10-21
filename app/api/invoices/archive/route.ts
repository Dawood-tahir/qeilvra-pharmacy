import { createClient } from "@/lib/supabase/server";
import { createArchiveBackend } from "@/lib/invoice-archive/backend";
import { currentVerifiedArchive } from "@/lib/invoice-archive/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export async function GET() {
  const session = await createClient();
  const { data: { user }, error: userError } = await session.auth.getUser();
  if (userError || !user) return Response.json({ error: "Sign in to download the invoice archive." }, { status: 401, headers });
  const { data: role, error: roleError } = await session.rpc("current_role");
  if (roleError || role !== "owner") return Response.json({ error: "Only the Owner can download invoice archives." }, { status: 403, headers });
  try {
    const { backend, signedDownload } = createArchiveBackend();
    const version = await currentVerifiedArchive(backend);
    if (!version) return Response.json({ error: "No verified invoice archive is available yet." }, { status: 404, headers });
    return Response.json({ url: await signedDownload(version.object_key), filename: "Qeilvra_Invoices.xlsx" }, { headers });
  } catch {
    return Response.json({ error: "The invoice archive could not be verified. Please try again later." }, { status: 503, headers });
  }
}
