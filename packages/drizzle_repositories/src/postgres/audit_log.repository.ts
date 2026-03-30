// @ts-nocheck
import type { SQL } from "drizzle-orm"
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm"
import type { PgDatabaseLike } from "./drizzle_repository.js"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import type { AuditLogEntityType, AuditLogEventType } from "../utils.js"
import type { AuditLogFilters } from "../audit/audit.schemas.js"
import type { PgDrizzleRepositorySchema } from "./drizzle_repository.js"
import { PgDrizzleRepository } from "./drizzle_repository.js"

type JsonSerializable = Record<string, unknown>

export type PgAuditLogSchema = PgDrizzleRepositorySchema & {
  auditLogs: PgTable
  user?: PgTable
}

export interface AuditLogEntry {
  event_type: AuditLogEventType
  entity_type: AuditLogEntityType
  entity_id?: string
  table_name?: string
  parent_id?: string
  user_id: string
  details?: JsonSerializable
  ip_address?: string
  user_agent?: string
  is_system_event?: number
}

export type AuditLogWithEmail = Record<string, unknown> & { user_email?: string }

export class PgAuditLogRepository<
  TSchema extends PgAuditLogSchema,
> extends PgDrizzleRepository<TSchema, TSchema["auditLogs"]> {
  private get t(): PgTable { return this.auditSchema.auditLogs as PgTable }

  constructor(
    db: PgDatabaseLike<TSchema>,
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
      is_system_event: entry.is_system_event ?? 0,
      created_at: now,
    } as unknown as Record<string, unknown>)
  }

  async getByEntity(entityType: AuditLogEntityType, entityId: string, options?: { limit?: number; offset?: number }) {
    const { limit = 50, offset = 0 } = options || {}
    return this.findMany({
      where: and(eq(this.t.entity_type, entityType), eq(this.t.entity_id, entityId)),
      pagination: { limit, page: Math.floor(offset / limit) + 1 },
      orderBy: [{ column: this.t.created_at as PgColumn, direction: "desc" }],
    })
  }

  async getByUser(userId: string, options?: { limit?: number; offset?: number }) {
    const { limit = 50, offset = 0 } = options || {}
    return this.findMany({
      where: eq(this.t.user_id, userId),
      pagination: { limit, page: Math.floor(offset / limit) + 1 },
      orderBy: [{ column: this.t.created_at as PgColumn, direction: "desc" }],
    })
  }

  async getByDateRange(startDate: number, endDate: number, options?: { limit?: number; offset?: number }) {
    const { limit = 50, offset = 0 } = options || {}
    return this.findMany({
      where: and(gte(this.t.created_at, startDate), lte(this.t.created_at, endDate)),
      pagination: { limit, page: Math.floor(offset / limit) + 1 },
      orderBy: [{ column: this.t.created_at as PgColumn, direction: "desc" }],
    })
  }

  async getByParent(parentId: string, options?: {
    limit?: number; page?: number; filters?: AuditLogFilters
  }): Promise<{ data: AuditLogWithEmail[]; total: number }> {
    const { limit = 50, page = 0, filters } = options || {}
    const conditions: SQL[] = [eq(this.t.parent_id, parentId)]
    if (filters?.search) {
      const searchTerm = `%${filters.search}%`
      const searchCondition = or(like(this.t.entity_type, searchTerm), like(this.t.event_type, searchTerm))
      if (searchCondition) conditions.push(searchCondition)
    }
    if (filters?.entities?.length) conditions.push(inArray(this.t.entity_type, filters.entities))
    if (filters?.actions?.length) conditions.push(inArray(this.t.event_type, filters.actions))
    const whereClause = and(...conditions)
    const countResult = await this.db.select({ count: sql<number>`count(*)` }).from(this.t).where(whereClause)
    const total = Number((countResult as { count: number }[])[0]?.count ?? 0)
    const offsetRows = page * limit
    const t = this.t as Record<string, unknown>
    const results = await this.db.select({
      id: t.id, event_type: t.event_type, entity_type: t.entity_type, entity_id: t.entity_id,
      table_name: t.table_name, parent_id: t.parent_id, user_id: t.user_id, details: t.details,
      ip_address: t.ip_address, user_agent: t.user_agent, is_system_event: t.is_system_event,
      created_at: t.created_at,
    } as Record<string, unknown>).from(this.t).where(whereClause)
      .orderBy(desc(this.t.created_at)).limit(limit).offset(offsetRows)
    const data = (results as Record<string, unknown>[]).map((row) => ({ ...row, user_email: "" })) as AuditLogWithEmail[]
    return { data, total }
  }

  async getById(id: string, workspaceId: string): Promise<AuditLogWithEmail | null> {
    const result = await this.db.select().from(this.t)
      .where(and(eq(this.t.id, id), eq(this.t.parent_id, workspaceId))).limit(1)
    const row = (result as Record<string, unknown>[])[0]
    if (!row) return null
    return { ...row, user_email: "" } as AuditLogWithEmail
  }
}
