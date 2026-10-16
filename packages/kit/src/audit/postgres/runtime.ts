import { sql } from "drizzle-orm"
import type { z } from "zod"

import {
  parseAuditEvent,
  type AuditEventCatalog,
  type AuditEventInput,
  type AuditEventName,
  type AuditEventSchemas,
} from "../events.js"
import {
  assertNonEmpty,
  DEFAULT_AUDIT_SCHEMA,
  DEFAULT_CONTEXT_KEY,
  DEFAULT_EVENTS_TABLE,
  normalizeContextColumns,
  qualifyName,
  quoteIdent,
} from "./sql-helpers.js"
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
  /** Default `public`. Match the install. */
  auditSchema?: string
  /** Default `audit_events`. Match the install. */
  eventsTable?: string
  /** GUC holding the actor id. Default `app.user_id`. */
  contextKey?: string
  /** Context columns of the events table, matching the install. */
  contextColumns?: AuditContextColumn[]
}

/**
 * Records one custom event in audit_events. The payload is validated against
 * the catalog. The actor and context columns are read from the same session
 * GUCs the audit trigger reads, so inside `withAuditedTransaction` the event is
 * attributed like the row changes and commits or rolls back with them.
 */
export async function recordAuditEvent<
  T extends AuditEventSchemas,
  K extends AuditEventName<T>,
>(
  db: AuditSqlExecutor,
  catalog: AuditEventCatalog<T>,
  name: K,
  input: AuditEventInput<z.input<T[K]>>,
  options?: RecordAuditEventOptions,
): Promise<void> {
  const event = parseAuditEvent(catalog, name, input)
  const auditSchema = assertNonEmpty(
    options?.auditSchema ?? DEFAULT_AUDIT_SCHEMA,
    "auditSchema",
  )
  const eventsTable = assertNonEmpty(
    options?.eventsTable ?? DEFAULT_EVENTS_TABLE,
    "eventsTable",
  )
  const contextKey = assertNonEmpty(
    options?.contextKey ?? DEFAULT_CONTEXT_KEY,
    "contextKey",
  )
  const contextColumns = normalizeContextColumns(options ?? {})

  const columns = [
    "name",
    "subject_type",
    "subject_id",
    "user_id",
    ...contextColumns.map((col) => col.column),
    "data",
  ]
  const fromSession = (key: string) => sql`NULLIF(current_setting(${key}, true), '')`
  const data = event.data == null ? null : JSON.stringify(event.data)
  const values = [
    sql`${event.name}`,
    sql`${event.subjectType}`,
    sql`${event.subjectId}`,
    fromSession(contextKey),
    ...contextColumns.map((col) => fromSession(col.sessionKey)),
    sql`${data}::jsonb`,
  ]

  await db.execute(
    sql`INSERT INTO ${sql.raw(qualifyName(eventsTable, auditSchema))} (${sql.raw(
      columns.map(quoteIdent).join(", "),
    )}) VALUES (${sql.join(values, sql`, `)})`,
  )
}
