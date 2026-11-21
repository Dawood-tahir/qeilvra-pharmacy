// Read in bounded pages so the response limit never truncates the list.
export async function readAllRows<T>(fetchPage: (start: number, end: number) => PromiseLike<{ data: unknown; error: unknown }>, message = "Supplier records could not be loaded. Please try again."): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 200) {
    const { data, error } = await fetchPage(start, start + 199);
    if (error) throw new Error(message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 200) return rows;
  }
}
