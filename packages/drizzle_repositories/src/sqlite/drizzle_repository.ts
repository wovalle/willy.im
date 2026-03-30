import {
  and, asc, desc, eq, getTableName, SQL, sql, type InferSelectModel,
} from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { SQLiteColumn, SQLiteTable, SQLiteTransaction } from "drizzle-orm/sqlite-core"
import {
  BaseDrizzleRepository, type BaseDrizzleRepositorySchema,
  type BaseRepositoryOptions, DatabaseError,
  type PaginationParams, type UpsertResult, type WhereCondition,
} from "../base_drizzle_repository.js"

export type { PaginationParams, WhereCondition }
export { DatabaseError }

export interface AuditContext {
  user?: { id: string } | null
  request?: Request
  skipAudit?: boolean
}

export type SqliteTransaction = SQLiteTransaction<"async", unknown, any, any>

export type SqliteRepositoryOptions = BaseRepositoryOptions & {
  tx?: SqliteTransaction
}

export type SqliteDrizzleRepositorySchema = BaseDrizzleRepositorySchema

type InferredSelectModel<T extends SQLiteTable> = InferSelectModel<T>

export class SqliteDrizzleRepository<
  TSchema extends SqliteDrizzleRepositorySchema,
  T extends SQLiteTable,
> extends BaseDrizzleRepository<TSchema, T, SqliteRepositoryOptions> {
  protected override db: DrizzleD1Database<TSchema>
  protected override table: T

  constructor(db: DrizzleD1Database<TSchema>, table: T) {
    super()
    this.db = db
    this.table = table
  }

  override async findMany<TReturn = InferredSelectModel<T>>(params?: {
    where?: WhereCondition
    pagination?: PaginationParams
    orderBy?: { column: SQLiteColumn; direction: "asc" | "desc" }[]
    tx?: SqliteTransaction
  }): Promise<TReturn[]> {
    try {
      const { where, pagination, orderBy, tx } = params || {}
      const dbInstance = tx || this.db
      const whereCondition = where
        ? Array.isArray(where) ? sql`${where.join(" AND ")}` : where
        : undefined
      const base = dbInstance.select().from(this.table)
      const withWhere = whereCondition !== undefined ? base.where(whereCondition) : base
      const withPagination = pagination
        ? withWhere.limit(pagination.limit ?? 10).offset(((pagination.page ?? 1) - 1) * (pagination.limit ?? 10))
        : withWhere
      const withOrderBy = orderBy && orderBy.length > 0
        ? withPagination.orderBy(...orderBy.map(({ column, direction }) =>
            direction === "asc" ? asc(column) : desc(column)))
        : withPagination
      const rows = await withOrderBy
      return rows as TReturn[]
    } catch (err) { throw this.handleError(err) }
  }

  override async findOne<TReturn = InferredSelectModel<T>>(params: {
    where: WhereCondition | undefined
    tx?: SqliteTransaction
  }): Promise<TReturn | undefined> {
    try {
      const { where, tx } = params
      const dbInstance = tx || this.db
      const result = await dbInstance.select().from(this.table)
        .where(Array.isArray(where) ? sql`${where.join(" AND ")}` : where).limit(1)
      return result[0] as TReturn | undefined
    } catch (err) { throw this.handleError(err) }
  }

  override async findById<TReturn = InferredSelectModel<T>>(
    id: number | string, params?: { tx?: SqliteTransaction },
  ): Promise<TReturn | undefined> {
    const pkColumn = this.getPrimaryKeyColumn()
    return this.findOne<TReturn>({ where: eq(pkColumn, id as never), tx: params?.tx })
  }

  override async doCreate<TData extends Record<string, unknown>, TReturn = InferredSelectModel<T>>(
    data: TData, options?: SqliteRepositoryOptions,
  ): Promise<TReturn> {
    const dbInstance = options?.tx || this.db
    const now = Math.floor(Date.now() / 1000)
    const dataWithTimestamps = {
      ...data,
      ...(this.hasColumn("created_at") && { created_at: now }),
      ...(this.hasColumn("updated_at") && { updated_at: now }),
    }
    const result = await dbInstance.insert(this.table).values({
      ...dataWithTimestamps,
      ...(this.hasColumn("id") && !dataWithTimestamps.id && { id: crypto.randomUUID() }),
    }).returning()
    return (result as TReturn[])[0] as TReturn
  }

  override async doUpdate<TData extends Record<string, unknown>, TReturn = InferredSelectModel<T>>(
    id: string | number, data: TData, options?: SqliteRepositoryOptions,
  ): Promise<TReturn> {
    const pkColumn = this.getPrimaryKeyColumn()
    const dbInstance = options?.tx || this.db
    const dataWithTimestamp = {
      ...data,
      ...(this.hasColumn("updated_at") && { updated_at: Math.floor(Date.now() / 1000) }),
    }
    const result = await dbInstance.update(this.table).set(dataWithTimestamp)
      .where(eq(pkColumn, id)).returning()
    return (result as TReturn[])[0] as TReturn
  }

  override async doDelete(id: string | number, options?: SqliteRepositoryOptions): Promise<void> {
    const pkColumn = this.getPrimaryKeyColumn()
    const dbInstance = options?.tx || this.db
    await dbInstance.delete(this.table).where(eq(pkColumn, id))
  }

  override async upsert<TData extends Record<string, unknown>, TReturn = InferredSelectModel<T>>(
    data: TData, options?: SqliteRepositoryOptions & { conflictColumns?: string[] },
  ): Promise<UpsertResult<TReturn>> {
    try {
      const dbInstance = options?.tx || this.db
      const conflictColumns = options?.conflictColumns || ["id"]
      const now = Math.floor(Date.now() / 1000)
      const dataWithTimestamps = {
        ...data,
        ...(this.hasColumn("created_at") && { created_at: now }),
        ...(this.hasColumn("updated_at") && { updated_at: now }),
      }
      const whereConditions = conflictColumns.map((col) => {
        const column = Object.values(this.table).find((c) => c.name === col)
        if (!column) throw new Error(`Column '${col}' not found in table`)
        return eq(column, data[col] as never)
      })
      const existing = (await dbInstance.select().from(this.table)
        .where(and(...whereConditions)).limit(1)) as TReturn[]
      if (existing.length > 0) {
        const updateData = { ...dataWithTimestamps }
        conflictColumns.forEach((col) => delete updateData[col])
        const updateResult = (await dbInstance.update(this.table).set(updateData)
          .where(and(...whereConditions)).returning()) as TReturn[]
        return { entity: updateResult[0], previousEntity: existing[0] }
      }
      const insertResult = (await dbInstance.insert(this.table).values({
        ...dataWithTimestamps,
        ...(this.hasColumn("id") && !dataWithTimestamps.id && { id: crypto.randomUUID() }),
      }).returning()) as TReturn[]
      return { entity: insertResult[0] }
    } catch (err) { throw this.handleError(err) }
  }

  override async count(params?: { where?: WhereCondition; tx?: SqliteTransaction }): Promise<number> {
    try {
      const { where, tx } = params || {}
      const dbInstance = tx || this.db
      const whereCondition = where
        ? Array.isArray(where) ? sql`${where.join(" AND ")}` : where
        : null
      type DbWithSelect = {
        select(selection: { count: ReturnType<typeof sql> }): {
          from(table: T): {
            $dynamic(): {
              where(condition: WhereCondition): Promise<{ count: number }[]>
            } & Promise<{ count: number }[]>
          }
        }
      }
      const db = dbInstance as unknown as DbWithSelect
      const countQuery = db.select({ count: sql<number>`count(*)` }).from(this.table).$dynamic()
      const result = whereCondition
        ? await countQuery.where(whereCondition)
        : await (countQuery as Promise<{ count: number }[]>)
      const value = result[0]?.count
      return typeof value === "number" ? value : Number(value) || 0
    } catch (err) { throw this.handleError(err) }
  }

  protected getPrimaryKeyColumn(): SQLiteColumn {
    const columns = Object.values(this.table)
    const pkColumn = columns.find((col) => col.primary)
    if (pkColumn) return pkColumn as SQLiteColumn
    const idColumn = columns.find((col) => col.name === "id")
    if (idColumn) return idColumn as SQLiteColumn
    const tableName = getTableName(this.table)
    throw new Error(`No primary key column found for table ${tableName}`)
  }

  protected hasColumn(columnName: string): boolean {
    return Object.values(this.table).some((col) => col.name === columnName)
  }

  protected handleError(err: unknown): Error {
    if (err instanceof Error) {
      if (err.message.includes("UNIQUE constraint failed"))
        return new DatabaseError("A record with this value already exists", {
          [err.message.split(": ")[1] || "field"]: ["This value must be unique"],
        })
      if (err.message.includes("NOT NULL constraint failed")) {
        const field = err.message.split(": ")[1] || "field"
        return new DatabaseError("Required field is missing", { [field]: ["This field is required"] })
      }
      if (err.message.includes("FOREIGN KEY constraint failed"))
        return new DatabaseError("Referenced record does not exist", {
          [err.message.split(": ")[1] || "field"]: ["Referenced record not found"],
        })
      return new DatabaseError(err.message)
    }
    return new DatabaseError("An unknown database error occurred")
  }
}
