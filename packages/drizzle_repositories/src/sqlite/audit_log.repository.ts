import type { SQL } from "drizzle-orm"
import { and, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"
import type { AuditLogEntry, AuditLogEntityType, AuditLogEventType } from "../utils.js"
export type AuditLogFilters = {
  search?: string
  entities?: string[]
  actions?: string[]
}
import type { SqliteDrizzleRepositorySchema } from "./drizzle_repository.js"
import { SqliteDrizzleRepository } from "./drizzle_repository.js"

export type { AuditLogEntry }

export type SqliteAuditLogSchema = SqliteDrizzleRepositorySchema & {
  auditLogs: SQLiteTable
  user?: SQLiteTable
}

export type AuditLogWithEmail = Record<string, unknown> & { user_email?: string }

export class SqliteAuditLogRepository<
  TSchema extends SqliteAuditLogSchema,
> extends SqliteDrizzleRepository<TSchema, TSchema["auditLogs"]> {
  private get t() { return this.table }

  constructor(
    db: DrizzleD1Database<TSchema>,
    table: TSchema["auditLogs"],
    private auditSchema: TSchema,
  ) { super(db, table) }

  async log(entry: AuditLogEntry): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.create({
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
    } as unknown as Record<string, unknown>)
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

  async getByParent(parentId: string, options?: {
    limit?: number; page?: number; filters?: AuditLogFilters
  }): Promise<{ data: AuditLogWithEmail[]; total: number }> {
    const { limit = 50, page = 0, filters } = options || {}
    const t = this.t as unknown as Record<string, SQLiteColumn>
    const conditions: SQL[] = [eq(t.parent_id, parentId)]
    if (filters?.search) {
      const searchTerm = `%${filters.search}%`
      const searchCondition = or(like(t.entity_type, searchTerm), like(t.event_type, searchTerm))
      if (searchCondition) conditions.push(searchCondition)
    }
    if (filters?.entities?.length) conditions.push(inArray(t.entity_type, filters.entities))
    if (filters?.actions?.length) conditions.push(inArray(t.event_type, filters.actions))
    const whereClause = and(...conditions)
    const countResult = await this.db.select({ count: sql<number>`count(*)` }).from(this.t).where(whereClause)
    const total = Number((countResult as { count: number }[])[0]?.count ?? 0)
    const offsetRows = page * limit
    const results = await this.db.select({
      id: t.id, event_type: t.event_type, entity_type: t.entity_type, entity_id: t.entity_id,
      table_name: t.table_name, parent_id: t.parent_id, user_id: t.user_id, details: t.details,
      ip_address: t.ip_address, user_agent: t.user_agent, is_system_event: t.is_system_event,
      created_at: t.created_at,
    } as Record<string, SQLiteColumn>).from(this.t).where(whereClause)
      .orderBy(sql`${t.created_at} DESC`).limit(limit).offset(offsetRows)
    const data = (results as Record<string, unknown>[]).map((row) => ({ ...row, user_email: "" })) as AuditLogWithEmail[]
    return { data, total }
  }

  async getById(id: string, workspaceId: string): Promise<AuditLogWithEmail | null> {
    const t = this.t as unknown as Record<string, SQLiteColumn>
    const result = await this.db.select().from(this.t)
      .where(and(eq(t.id, id), eq(t.parent_id, workspaceId))).limit(1)
    const row = result[0]
    if (!row) return null
    return { ...row, user_email: "" } as AuditLogWithEmail
  }
}
