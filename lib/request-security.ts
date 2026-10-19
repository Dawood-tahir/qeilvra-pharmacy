/** Route handlers do not receive Server Actions' built-in Origin check. */
export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;
  // Browser mutations send Origin. Non-browser clients must still authenticate.
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
