import { sql } from "drizzle-orm"

import type { AuditEvent } from "../audit-event.js"
import {
  DEFAULT_AUDIT_SCHEMA,
  DEFAULT_AUDIT_TABLE,
  DEFAULT_CONTEXT_KEY,
  assertNonEmpty,
  normalizeContextColumns,
  qualifyName,
  quoteIdent,
} from "./sql.js"
import type {
  AuditContextColumn,
  AuditSqlExecutor,
  AuditTransactionCapable,
} from "./types.js"

const DEFAULT_ACTOR_KEY = "app.user_id"
const DEFAULT_CONTEXT_PREFIX = "app."

function assertActorId(actorId: string) {
  if (actorId.trim().length === 0) {
    throw new Error("actorId must not be empty")
  }
}

export type AuditContextOptions = {
  /** GUC that receives the actor id. Default `app.user_id`. */
  actorKey?: string
  /**
   * Context values keyed by **column name** (e.g. `workspace_id`). Each is
   * written to the GUC `${contextPrefix}${column}`, matching the trigger's
   * default `sessionKey` of `app.${column}`. Empty/`undefined` values are
   * dropped so the column stays NULL.
   */
  context?: Record<string, string>
  /**
   * Prefix prepended to each context column name to form its GUC. Default
   * `app.`. Set to `""` to pass fully-qualified GUC names in `context` (e.g.
   * when a column uses a custom `sessionKey`).
   */
  contextPrefix?: string
}

export async function setAuditContext(
  db: AuditSqlExecutor,
  actorId: string,
  options?: AuditContextOptions,
) {
  assertActorId(actorId)

  const actorKey = options?.actorKey ?? DEFAULT_ACTOR_KEY
  await db.execute(
    sql`select set_config(${actorKey}, ${actorId}, true) as audit_context`,
  )

  const prefix = options?.contextPrefix ?? DEFAULT_CONTEXT_PREFIX
  for (const [column, value] of Object.entries(options?.context ?? {})) {
    if (value === undefined || value === "") continue
    await db.execute(
      sql`select set_config(${prefix + column}, ${value}, true) as audit_context`,
    )
  }
}

export async function withAuditedTransaction<
  TTransaction extends AuditSqlExecutor,
  TResult,
>(
  db: AuditTransactionCapable<TTransaction>,
  actorId: string,
  callback: (tx: TTransaction) => Promise<TResult> | TResult,
  options?: AuditContextOptions,
) {
  assertActorId(actorId)

  return db.transaction(async (tx) => {
    await setAuditContext(tx, actorId, options)
    return await callback(tx)
  })
}

export type RecordAuditEventOptions = {
  auditSchema?: string
  auditTable?: string
  /** GUC read for `user_id`. Default `app.user_id`. */
  contextKey?: string
  /** Context columns of the audit table, as passed to the installer. */
  contextColumns?: AuditContextColumn[]
}

function jsonParam(value: Record<string, unknown> | null | undefined) {
  if (!value) {
    return sql`null::jsonb`
  }

  return sql`${JSON.stringify(value)}::jsonb`
}

/**
 * Log one event the triggers can't see: a change made through another library,
 * or an action that changes no row. `user_id` and the context columns are read
 * from the same GUCs the trigger reads, so it picks up `setAuditContext` /
 * `withAuditedTransaction` and commits or rolls back with the surrounding
 * transaction. `operation` is free-form ("invite", "revoke").
 */
export async function recordAuditEvent(
  db: AuditSqlExecutor,
  event: AuditEvent,
  options?: RecordAuditEventOptions,
) {
  const table = assertNonEmpty(event.table, "table")
  const operation = assertNonEmpty(event.operation, "operation")
  const auditSchema = assertNonEmpty(
    options?.auditSchema ?? DEFAULT_AUDIT_SCHEMA,
    "auditSchema",
  )
  const auditTable = assertNonEmpty(
    options?.auditTable ?? DEFAULT_AUDIT_TABLE,
    "auditTable",
  )
  const contextKey = assertNonEmpty(
    options?.contextKey ?? DEFAULT_CONTEXT_KEY,
    "contextKey",
  )
  const contextColumns = normalizeContextColumns(options ?? {})

  const columns = [
    "table_name",
    "operation",
    "row_id",
    "user_id",
    ...contextColumns.map((col) => quoteIdent(col.column)),
    "old_data",
    "new_data",
  ]
  const values = [
    sql`${table}`,
    sql`${operation}`,
    sql`${event.rowId ?? null}`,
    sql`NULLIF(current_setting(${contextKey}, true), '')`,
    ...contextColumns.map((col) => sql`NULLIF(current_setting(${col.sessionKey}, true), '')`),
    jsonParam(event.oldData),
    jsonParam(event.newData),
  ]

  await db.execute(
    sql`insert into ${sql.raw(qualifyName(auditTable, auditSchema))} (${sql.raw(columns.join(", "))}) values (${sql.join(values, sql`, `)})`,
  )
}
