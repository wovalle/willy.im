import { sql } from "drizzle-orm"

import type { D1AuditSqlExecutor } from "./types.js"

const DEFAULT_CONTEXT_TABLE = "_audit_context"

function assertActorId(actorId: string) {
  if (actorId.trim().length === 0) {
    throw new Error("actorId must not be empty")
  }
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
  options?: { workspaceId?: string; contextTable?: string },
) {
  assertActorId(actorId)
  const table = options?.contextTable ?? DEFAULT_CONTEXT_TABLE

  db.run(
    sql`INSERT OR REPLACE INTO ${sql.identifier(table)} (key, value) VALUES ('user_id', ${actorId})`,
  )

  if (options?.workspaceId !== undefined && options.workspaceId !== "") {
    db.run(
      sql`INSERT OR REPLACE INTO ${sql.identifier(table)} (key, value) VALUES ('workspace_id', ${options.workspaceId})`,
    )
  }
}

/**
 * Clears the audit context after a transaction completes.
 * Called automatically by withD1AuditedTransaction.
 */
export function clearD1AuditContext(
  db: D1AuditSqlExecutor,
  options?: { contextTable?: string },
) {
  const table = options?.contextTable ?? DEFAULT_CONTEXT_TABLE
  db.run(
    sql`DELETE FROM ${sql.identifier(table)} WHERE key IN ('user_id', 'workspace_id')`,
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
  options?: { workspaceId?: string; contextTable?: string },
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
