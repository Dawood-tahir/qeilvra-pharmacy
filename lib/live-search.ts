export const NO_SEARCH_MATCHES = "No matching records found";

export function searchQuery(value?: string | string[] | null) {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 100) ?? "";
}

export function matchesSearch(fields: readonly (string | null | undefined)[], term: string) {
  return !term || fields.some((field) => field?.toLowerCase().includes(term));
}

export function textSearchFilter(query: string, ...columns: string[]) {
  // Escape the literal twice, once for PostgreSQL regex and once for the quoted PostgREST value.
  const pattern = query.replace(/[.*+?^$\x7b\x7d()[\]\\|]/g, "\\$&").replace(/[\\"]/g, "\\$&");
  return columns.map((column) => column + '.imatch."' + pattern + '"').join(",");
}
