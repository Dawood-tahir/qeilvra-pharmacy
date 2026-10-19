export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  // Quoting a CSV field alone does not prevent spreadsheet formula execution.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(values: unknown[]) { return values.map(csvCell).join(",") + "\r\n"; }
