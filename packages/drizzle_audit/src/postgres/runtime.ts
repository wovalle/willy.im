import { sql } from "drizzle-orm"

import type {
  AuditSqlExecutor,
  AuditTransactionCapable,
} from "./types.js"

function assertActorId(actorId: string) {
  if (actorId.trim().length === 0) {
    throw new Error("actorId must not be empty")
  }
}

/**
 * Builds the `context` GUC map from a set of options. Empty/undefined values
 * are dropped so the trigger's NULLIF yields NULL.
 */
function resolveContext(options?: AuditContextOptions): Record<string, string> {
  const context: Record<string, string> = {}

  for (const [key, value] of Object.entries(options?.context ?? {})) {
    if (value !== undefined && value !== "") {
      context[key] = value
    }
  }

  return context
}

export type AuditContextOptions = {
  /** Map of session GUC name → value to set for the transaction. */
  context?: Record<string, string>
}

export async function setAuditContext(
  db: AuditSqlExecutor,
  actorId: string,
  contextKey = "app.user_id",
  options?: AuditContextOptions,
) {
  assertActorId(actorId)

  await db.execute(
    sql`select set_config(${contextKey}, ${actorId}, true) as audit_context`,
  )

  for (const [key, value] of Object.entries(resolveContext(options))) {
    await db.execute(
      sql`select set_config(${key}, ${value}, true) as audit_context`,
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
  contextKey = "app.user_id",
  options?: AuditContextOptions,
) {
  assertActorId(actorId)

  return db.transaction(async (tx) => {
    await setAuditContext(tx, actorId, contextKey, options)
    return await callback(tx)
  })
}
