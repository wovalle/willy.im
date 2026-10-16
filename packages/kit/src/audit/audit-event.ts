/** An event logged by hand: what a trigger or wrapper can't see for itself. */
export type AuditEvent = {
  /** What was touched: a table, or any entity type ("user", "oauth_client"). */
  table: string
  /** `INSERT` / `UPDATE` / `DELETE`, or a verb of your own ("invite", "revoke"). */
  operation: string
  rowId?: string | null
  oldData?: Record<string, unknown> | null
  newData?: Record<string, unknown> | null
}
