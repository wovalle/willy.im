import { withAudit } from "@willyim/kit/audit/d1-runtime"
import { and, desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import type { BaseServiceContext } from "./services"

/**
 * Audit trail for privileged actions, on `@willyim/kit/audit`. These are events
 * (invite, revoke, impersonate…) with a curated before/after, not row diffs:
 * several of the writes happen inside Better Auth, out of a wrapper's sight.
 * Writes are best-effort: a failure to log must never break the action being
 * audited.
 */

/**
 * Application scope for rows that belong to the IdP itself rather than to any
 * one app (admin keys, for instance). `application_id` is NOT NULL and every
 * reader filters by it, so IdP-level rows need a reserved value instead: the
 * double underscores keep it from ever colliding with a real app key.
 */
export const IDP_AUDIT_SCOPE = "__idp__"

/** Who performed an action, normalized for the `user_id` + `actor` columns. */
export type Actor = {
  /** Human user id, when there is one. Null for machine callers. */
  userId: string | null
  /** Descriptor: "user:<id>" | "adminkey:<id>" | "apikey:<id>". */
  label: string
}

export type AuditOperation =
  | "create"
  | "update"
  | "delete"
  | "revoke"
  | "invite"
  | "impersonate"
  | "issue"

export async function recordAudit(
  ctx: BaseServiceContext,
  entry: {
    actor: Actor
    /** Entity type, e.g. "api_key", "application_member", "organization". */
    table: string
    operation: AuditOperation
    applicationId: string
    rowId?: string | null
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await withAudit(ctx.db, schema.auditLog, {
      userId: entry.actor.userId,
      context: { application_id: entry.applicationId, actor: entry.actor.label },
    }).record({
      table: entry.table,
      operation: entry.operation,
      rowId: entry.rowId,
      oldData: entry.before,
      newData: entry.after,
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

const toEntry = (row: typeof schema.auditLog.$inferSelect): AuditEntry => ({
  id: row.id,
  tableName: row.table_name,
  operation: row.operation,
  rowId: row.row_id,
  userId: row.user_id,
  actor: row.actor,
  createdAt: row.created_at,
})

/** Recent audit entries for one app, newest first. */
export async function listAuditForApp(
  ctx: BaseServiceContext,
  app: string,
  limit = 50,
): Promise<AuditEntry[]> {
  const rows = await ctx.db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.application_id, app))
    .orderBy(desc(schema.auditLog.id))
    .limit(limit)
  return rows.map(toEntry)
}

/** A single entity's history (e.g. one API key), newest first. */
export async function listAuditForRow(
  ctx: BaseServiceContext,
  app: string,
  table: string,
  rowId: string,
): Promise<AuditEntry[]> {
  const rows = await ctx.db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.application_id, app),
        eq(schema.auditLog.table_name, table),
        eq(schema.auditLog.row_id, rowId),
      ),
    )
    .orderBy(desc(schema.auditLog.id))
  return rows.map(toEntry)
}
