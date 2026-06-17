import { sql } from "drizzle-orm"

import type { D1AuditSqlExecutor } from "./types.js"

const DEFAULT_CONTEXT_TABLE = "_audit_context"

function assertActorId(actorId: string) {
  if (actorId.trim().length === 0) {
    throw new Error("actorId must not be empty")
  }
}

export type D1AuditContextOptions = {
  /** Map of context key → value written as KV rows the triggers read. */
  context?: Record<string, string>
  contextTable?: string
}

/**
 * Builds the KV map (key → value) to write. Empty/undefined values are dropped
 * so the corresponding column stays NULL.
 */
function resolveContext(options?: D1AuditContextOptions): Record<string, string> {
  const context: Record<string, string> = {}

  for (const [key, value] of Object.entries(options?.context ?? {})) {
    if (value !== undefined && value !== "") {
      context[key] = value
    }
  }

  return context
}

/**
 * Sets the audit context for the current transaction by writing to the
 * _audit_context table. Must be called inside a transaction before any
 * audited writes.
 *
 * D1/SQLite has no session variables, so triggers read context from this table.
 */
export function setD1AuditContext(
  db: D1AuditSqlExecutor,
  actorId: string,
  options?: D1AuditContextOptions,
) {
  assertActorId(actorId)
  const table = options?.contextTable ?? DEFAULT_CONTEXT_TABLE
  const context = resolveContext(options)

  const writeKv = (key: string, value: string) =>
    db.run(
      sql`INSERT OR REPLACE INTO ${sql.identifier(table)} (key, value) VALUES (${key}, ${value})`,
    )

  const result = writeKv("user_id", actorId)

  // Handle async drivers (D1) by chaining if result is a Promise
  if (result && typeof (result as Promise<unknown>).then === "function") {
    return Object.entries(context).reduce<Promise<unknown>>(
      (prev, [key, value]) => prev.then(() => writeKv(key, value)),
      result as Promise<unknown>,
    )
  }

  for (const [key, value] of Object.entries(context)) {
    writeKv(key, value)
  }
}

/**
 * Clears the audit context after a transaction completes.
 * Called automatically by withD1AuditedTransaction.
 *
 * Clears `user_id` plus any keys set via `context` so the next transaction
 * starts clean.
 */
export function clearD1AuditContext(
  db: D1AuditSqlExecutor,
  options?: D1AuditContextOptions,
) {
  const table = options?.contextTable ?? DEFAULT_CONTEXT_TABLE
  const keys = ["user_id", ...Object.keys(options?.context ?? {})]
  const uniqueKeys = [...new Set(keys)]
  const keyList = sql.join(
    uniqueKeys.map((k) => sql`${k}`),
    sql`, `,
  )
  return db.run(
    sql`DELETE FROM ${sql.identifier(table)} WHERE key IN (${keyList})`,
  )
}

/**
 * Wraps a Drizzle SQLite transaction with audit context. Sets the actor
 * before the callback and clears the context after (success or failure).
 *
 * Works with any Drizzle SQLite instance (better-sqlite3, D1, libsql).
 *
 * @example
 * // better-sqlite3 (sync)
 * withD1AuditedTransaction(db, "user_123", (tx) => {
 *   tx.insert(users).values({ id: "u1", name: "Ada" }).run()
 * })
 *
 * @example
 * // D1 (async)
 * await withD1AuditedTransaction(db, "user_123", async (tx) => {
 *   await tx.insert(users).values({ id: "u1", name: "Ada" })
 * })
 */
export function withD1AuditedTransaction<TDb extends D1AuditSqlExecutor, TResult>(
  db: TDb & { transaction: (cb: (tx: any) => TResult) => TResult },
  actorId: string,
  callback: (tx: TDb) => TResult,
  options?: D1AuditContextOptions,
): TResult {
  assertActorId(actorId)

  return (db as any).transaction((tx: any) => {
    setD1AuditContext(tx, actorId, options)
    try {
      return callback(tx)
    } finally {
      clearD1AuditContext(tx, options)
    }
  })
}
