import type { SQL } from "drizzle-orm"

/**
 * Minimal interface for executing raw SQL. Any Drizzle SQLite instance
 * (D1, better-sqlite3, libsql) or transaction satisfies this.
 */
export type D1AuditSqlExecutor = {
  run: (query: SQL) => unknown
}

export type AuditContextColumn = {
  /** Column added to the audit table (TEXT, nullable). */
  column: string
  /** The `_audit_context` key the trigger reads. Default `${column}`. */
  sessionKey?: string
  /** Create an index on the column. Default true. */
  index?: boolean
}

export type D1AuditInstallOptions = {
  /** Name of the audit log table (default: "audit_logs") */
  auditTable?: string
  /** Name of the context table used to pass user_id to triggers (default: "_audit_context") */
  contextTable?: string
  /** Extra context columns added to the audit table and populated by triggers from the _audit_context KV table. */
  contextColumns?: AuditContextColumn[]
  /**
   * @deprecated Use `contextColumns: [{ column: "workspace_id" }]` instead.
   * Optional workspace column name (e.g. "workspace_id").
   */
  workspaceIdColumn?: string
}

export type D1AuditTriggerTarget = {
  table: string
  rowIdColumn?: string
  triggerPrefix?: string
}
