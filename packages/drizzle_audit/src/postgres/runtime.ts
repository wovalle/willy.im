import { sql } from "drizzle-orm"

import type {
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
