import type { SQL } from "drizzle-orm"

export type AuditSqlExecutor = {
  execute: (query: SQL) => Promise<unknown>
}

export type AuditTransactionCapable<TTransaction extends AuditSqlExecutor> = {
  transaction: <TResult>(
    callback: (tx: TTransaction) => Promise<TResult>,
  ) => Promise<TResult>
}

export type AuditInstallOptions = {
  auditSchema?: string
  auditTable?: string
  contextKey?: string
  triggerFunctionName?: string
  /** When set (e.g. "workspace_id"), the audit table and trigger include this column; trigger reads from session variable app.${workspaceIdColumn}. */
  workspaceIdColumn?: string
}

export type AuditTriggerTarget = {
  table: string
  schema?: string
  rowIdColumn?: string
  triggerName?: string
}
