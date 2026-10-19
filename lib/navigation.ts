/** Accept only local application paths, including after browser URL normalization. */
export function safeAppPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://qeilvra.invalid");
    return url.origin === "https://qeilvra.invalid" ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}
