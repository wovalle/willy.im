import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import type { ApiPrincipal } from "./api-keys.server"
import type { User } from "./auth.server"
import type { BaseServiceContext } from "./services"

/**
 * Audit trail for privileged actions. Writes are best-effort: a failure to log
 * must never break the action being audited. Mirrors the @willyim/drizzle-audit
 * D1 schema (see schema.ts) so it can be swapped to the package later.
 */

/** Who performed an action, normalized for the `user_id` + `actor` columns. */
export type Actor = {
  /** Human user id, when there is one. Null for machine callers. */
  userId: string | null
  /** Descriptor: "user:<id>" | "apikey:<id>" | "superadmin-token". */
  label: string
}

export function actorFromUser(user: Pick<User, "id">): Actor {
  return { userId: user.id, label: `user:${user.id}` }
}

export function actorFromPrincipal(principal: ApiPrincipal): Actor {
  if (principal.kind === "superadmin") return { userId: null, label: "superadmin-token" }
  return { userId: null, label: `apikey:${principal.keyId}` }
}

export type AuditOperation =
  | "create"
  | "update"
  | "delete"
  | "revoke"
  | "invite"
  | "impersonate"

export async function recordAudit(
  ctx: BaseServiceContext,
  entry: {
    actor: Actor
    /** Entity type, e.g. "api_key", "application_member", "organization". */
    table: string
    operation: AuditOperation
    applicationId: string
    rowId?: string | null
    before?: unknown
    after?: unknown
  },
): Promise<void> {
  try {
    await ctx.db.insert(schema.auditLog).values({
      tableName: entry.table,
      operation: entry.operation,
      rowId: entry.rowId ?? null,
      applicationId: entry.applicationId,
      userId: entry.actor.userId,
      actor: entry.actor.label,
      oldData: entry.before ?? null,
      newData: entry.after ?? null,
    })
  } catch (err) {
    ctx.logger.warn("audit.record_failed", {
      table: entry.table,
      operation: entry.operation,
      applicationId: entry.applicationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export type AuditEntry = {
  id: number
  tableName: string
  operation: string
  rowId: string | null
  userId: string | null
  actor: string | null
  createdAt: string
}

/** Recent audit entries for one app, newest first. */
export async function listAuditForApp(
  ctx: BaseServiceContext,
  app: string,
  limit = 50,
): Promise<AuditEntry[]> {
  return ctx.db
    .select({
      id: schema.auditLog.id,
      tableName: schema.auditLog.tableName,
      operation: schema.auditLog.operation,
      rowId: schema.auditLog.rowId,
      userId: schema.auditLog.userId,
      actor: schema.auditLog.actor,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.applicationId, app))
    .orderBy(desc(schema.auditLog.id))
    .limit(limit)
}

/** A single entity's history (e.g. one API key), newest first. */
export async function listAuditForRow(
  ctx: BaseServiceContext,
  app: string,
  table: string,
  rowId: string,
): Promise<AuditEntry[]> {
  return ctx.db
    .select({
      id: schema.auditLog.id,
      tableName: schema.auditLog.tableName,
      operation: schema.auditLog.operation,
      rowId: schema.auditLog.rowId,
      userId: schema.auditLog.userId,
      actor: schema.auditLog.actor,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.applicationId, app),
        eq(schema.auditLog.tableName, table),
        eq(schema.auditLog.rowId, rowId),
      ),
    )
    .orderBy(desc(schema.auditLog.id))
}
