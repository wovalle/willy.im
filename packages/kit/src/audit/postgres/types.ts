import type { SQL } from "drizzle-orm"

export type AuditSqlExecutor = {
  execute: (query: SQL) => Promise<unknown>
}

export type AuditTransactionCapable<TTransaction extends AuditSqlExecutor> = {
  transaction: <TResult>(
    callback: (tx: TTransaction) => Promise<TResult>,
  ) => Promise<TResult>
}

export type AuditContextColumn = {
  /** Column added to the audit table (TEXT, nullable). */
  column: string
  /** Session GUC the trigger reads. Default `app.${column}`. */
  sessionKey?: string
  /** Create an index on the column. Default true. */
  index?: boolean
}

export type AuditInstallOptions = {
  auditSchema?: string
  auditTable?: string
  contextKey?: string
  triggerFunctionName?: string
  /** Extra context columns added to the audit table and populated by the trigger from session GUCs. */
  contextColumns?: AuditContextColumn[]
}

export type AuditTriggerTarget = {
  table: string
  schema?: string
  rowIdColumn?: string
  triggerName?: string
  /** UPDATEs that change only these columns are not logged. Logged rows still include them. */
  ignoreColumns?: string[]
  /** Only UPDATEs that change at least one of these columns are logged. Mutually exclusive with ignoreColumns. */
  onlyColumns?: string[]
}
