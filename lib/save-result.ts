// A transport failure does not tell us whether PostgreSQL committed the write.
// Only known validation, constraint, permission and transaction rollback errors
// allow the form to be edited and submitted as a new request immediately.
export function saveOutcomeUnknown(code?: string) {
  return !/^(P0001|22|23|40|42|PGRST1|PGRST2)/.test(code ?? "");
}
