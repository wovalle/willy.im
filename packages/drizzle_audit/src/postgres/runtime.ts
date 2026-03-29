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

export async function setAuditContext(
  db: AuditSqlExecutor,
  actorId: string,
  contextKey = "app.user_id",
  options?: { workspaceId?: string; workspaceContextKey?: string },
) {
  assertActorId(actorId)

  await db.execute(
    sql`select set_config(${contextKey}, ${actorId}, true) as audit_context`,
  )
  if (options?.workspaceId !== undefined && options.workspaceId !== "") {
    const wsKey = options.workspaceContextKey ?? "app.workspace_id"
    await db.execute(
      sql`select set_config(${wsKey}, ${options.workspaceId}, true) as workspace_context`,
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
  options?: { workspaceId?: string; workspaceContextKey?: string },
) {
  assertActorId(actorId)

  return db.transaction(async (tx) => {
    await setAuditContext(tx, actorId, contextKey, options)
    return await callback(tx)
  })
}
