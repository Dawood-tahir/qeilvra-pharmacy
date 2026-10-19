import { describe, expect, it } from "vitest";
import { safeAppPath } from "@/lib/navigation";
import { isSameOriginMutation } from "@/lib/request-security";
import { csvCell } from "@/lib/csv";

describe("local navigation boundaries", () => {
  it.each(["//evil.test", "/\\evil.test", "/\t/evil.test", "https://evil.test", "javascript:alert(1)", "/\n/evil.test"])("rejects external/normalized redirect %j", path => {
    expect(safeAppPath(path)).toBe("/dashboard");
  });
  it("preserves local paths and query strings", () => {
    expect(safeAppPath("/medicines?q=para#stock")).toBe("/medicines?q=para#stock");
  });
});

describe("mutation origin boundaries", () => {
  const crossOriginHeaders: Record<string, string>[] = [{ origin: "https://evil.test" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }];
  it("allows authenticated non-browser requests and same-origin browser requests", () => {
    expect(isSameOriginMutation(new Request("https://qeilvra.test/api/checkout"))).toBe(true);
    expect(isSameOriginMutation(new Request("https://qeilvra.test/api/checkout", { headers: { origin: "https://qeilvra.test" } }))).toBe(true);
  });
  it.each(crossOriginHeaders)("rejects cross-origin requests", headers => {
    expect(isSameOriginMutation(new Request("https://qeilvra.test/api/checkout", { headers }))).toBe(false);
  });
});

describe("spreadsheet exports", () => {
  it.each(["=HYPERLINK(\"https://evil.test\")", "+1", "-1", "@SUM(A1)", "  =1+1", "\t=1+1", "\r=1+1", "\n=1+1"])("escapes formula cell %j", value => {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  });
  it("preserves ordinary text, quotes, and nulls", () => {
    expect(csvCell('Batch "A"')).toBe('"Batch ""A"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell("Paracetamol")).toBe('"Paracetamol"');
  });
});
