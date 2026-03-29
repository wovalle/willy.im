import type { SQL } from "drizzle-orm"

/**
 * Minimal interface for executing raw SQL. Any Drizzle SQLite instance
 * (D1, better-sqlite3, libsql) or transaction satisfies this.
 */
export type D1AuditSqlExecutor = {
  run: (query: SQL) => unknown
}

export type D1AuditInstallOptions = {
  /** Name of the audit log table (default: "audit_logs") */
  auditTable?: string
  /** Name of the context table used to pass user_id to triggers (default: "_audit_context") */
  contextTable?: string
  /** Optional workspace column name (e.g. "workspace_id") */
  workspaceIdColumn?: string
}

export type D1AuditTriggerTarget = {
  table: string
  rowIdColumn?: string
  triggerPrefix?: string
}
