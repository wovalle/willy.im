import { and, eq, gte, lte } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"
import type { AuditLogEntry, AuditLogEntityType, AuditLogEventType } from "../utils.js"
import type { SqliteDrizzleRepositorySchema } from "./drizzle_repository.js"
import { SqliteDrizzleRepository } from "./drizzle_repository.js"

export type { AuditLogEntry }

export type SqliteAuditLogSchema = SqliteDrizzleRepositorySchema & {
  auditLogs: SQLiteTable
}

export class SqliteAuditLogRepository<
  TSchema extends SqliteAuditLogSchema,
> extends SqliteDrizzleRepository<TSchema, TSchema["auditLogs"]> {
  private get t() { return this.table }

  constructor(
    db: DrizzleD1Database<TSchema>,
    table: TSchema["auditLogs"],
  ) { super(db, table) }

  async log(entry: AuditLogEntry): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const data: Record<string, unknown> = {
      id: crypto.randomUUID(),
      event_type: entry.event_type,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      table_name: entry.table_name,
      parent_id: entry.parent_id,
      user_id: entry.user_id,
      details: entry.details ? JSON.stringify(entry.details) : null,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      is_system_event: entry.is_system_event || 0,
      created_at: now,
    }
    await this.create(data)
  }

  async getByEntity(entityType: AuditLogEntityType, entityId: string, options?: { limit?: number; offset?: number }) {
    const { limit = 50, offset = 0 } = options || {}
    const t = this.t as unknown as Record<string, SQLiteColumn>
    return this.findMany({
      where: and(eq(t.entity_type, entityType), eq(t.entity_id, entityId)),
      pagination: { limit, page: Math.floor(offset / limit) + 1 },
      orderBy: [{ column: t.created_at, direction: "desc" as const }],
    })
  }

  async getByUser(userId: string, options?: { limit?: number; offset?: number }) {
    const { limit = 50, offset = 0 } = options || {}
    const t = this.t as unknown as Record<string, SQLiteColumn>
    return this.findMany({
      where: eq(t.user_id, userId),
      pagination: { limit, page: Math.floor(offset / limit) + 1 },
      orderBy: [{ column: t.created_at, direction: "desc" as const }],
    })
  }

  async getByDateRange(startDate: number, endDate: number, options?: { limit?: number; offset?: number }) {
    const { limit = 50, offset = 0 } = options || {}
    const t = this.t as unknown as Record<string, SQLiteColumn>
    return this.findMany({
      where: and(
        gte(t.created_at, startDate as never),
        lte(t.created_at, endDate as never),
      ),
      pagination: { limit, page: Math.floor(offset / limit) + 1 },
      orderBy: [{ column: t.created_at, direction: "desc" as const }],
    })
  }
}
