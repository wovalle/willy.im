import {
  and, asc, desc, eq, getTableName, sql, type InferSelectModel,
} from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"

export type PgDatabaseLike<TSchema extends Record<string, unknown>> = NodePgDatabase<TSchema>

import {
  BaseDrizzleRepository, type BaseDrizzleRepositorySchema,
  type BaseRepositoryOptions, DatabaseError,
  type PaginationParams, type UpsertResult, type WhereCondition,
} from "../base_drizzle_repository.js"

export type { PaginationParams, WhereCondition }
export { DatabaseError }

export type PgTransaction<TSchema extends Record<string, unknown>> = Parameters<
  Parameters<PgDatabaseLike<TSchema>["transaction"]>[0]
>[0]

export type PgRepositoryOptions = BaseRepositoryOptions & {
  tx?: PgTransaction<BaseDrizzleRepositorySchema>
}

export type PgDrizzleRepositorySchema = BaseDrizzleRepositorySchema

type InferredSelectModel<T extends PgTable> = InferSelectModel<T>

export class PgDrizzleRepository<
  TSchema extends PgDrizzleRepositorySchema,
  T extends PgTable,
> extends BaseDrizzleRepository<TSchema, T, PgRepositoryOptions> {
  protected override db: PgDatabaseLike<TSchema>
  protected override table: T

  constructor(db: PgDatabaseLike<TSchema>, table: T) {
    super()
    this.db = db
    this.table = table
  }

  override async findMany<TReturn = InferredSelectModel<T>>(params?: {
    where?: WhereCondition
    pagination?: PaginationParams
    orderBy?: { column: PgColumn; direction: "asc" | "desc" }[]
    tx?: PgTransaction<TSchema>
  }): Promise<TReturn[]> {
    return this.execute(async () => {
      const { where, pagination, orderBy, tx } = params || {}
      const dbInstance = (tx ?? this.db) as NodePgDatabase<TSchema>
      const whereCondition = where
        ? Array.isArray(where) ? and(...where) : where
        : undefined
      const base = dbInstance.select().from(this.table as never)
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
    })
  }

  override async findOne<TReturn = InferredSelectModel<T>>(params: {
    where: WhereCondition | undefined
    tx?: PgTransaction<TSchema>
  }): Promise<TReturn | undefined> {
    return this.execute(async () => {
      const { where, tx } = params
      const dbInstance = (tx ?? this.db) as NodePgDatabase<TSchema>
      const result = await dbInstance.select().from(this.table as never)
        .where(Array.isArray(where) ? and(...where) : where).limit(1)
      return result[0] as TReturn | undefined
    })
  }

  override async findById<TReturn = InferredSelectModel<T>>(
    id: number | string, params?: { tx?: PgTransaction<TSchema> },
  ): Promise<TReturn | undefined> {
    const pkColumn = this.getPrimaryKeyColumn()
    return this.findOne<TReturn>({ where: eq(pkColumn, id as never), tx: params?.tx })
  }

  override async doCreate<TData extends Record<string, unknown>, TReturn = InferredSelectModel<T>>(
    data: TData, options?: PgRepositoryOptions,
  ): Promise<TReturn> {
    return this.execute(async () => {
      const dbInstance = (options?.tx ?? this.db) as NodePgDatabase<TSchema>
      const now = Math.floor(Date.now() / 1000)
      const dataWithTimestamps = {
        ...data,
        ...(this.hasColumn("created_at") && { created_at: now }),
        ...(this.hasColumn("updated_at") && { updated_at: now }),
      }
      const result = await dbInstance.insert(this.table as never).values({
        ...dataWithTimestamps,
        ...(this.hasColumn("id") && !dataWithTimestamps.id && { id: crypto.randomUUID() }),
      } as never).returning()
      return result[0] as TReturn
    })
  }

  override async doUpdate<TData extends Record<string, unknown>, TReturn = InferredSelectModel<T>>(
    id: string | number, data: TData, options?: PgRepositoryOptions,
  ): Promise<TReturn> {
    return this.execute(async () => {
      const pkColumn = this.getPrimaryKeyColumn()
      const dbInstance = (options?.tx ?? this.db) as NodePgDatabase<TSchema>
      const dataWithTimestamp = {
        ...data,
        ...(this.hasColumn("updated_at") && { updated_at: Math.floor(Date.now() / 1000) }),
      }
      const result = await dbInstance.update(this.table as never)
        .set(dataWithTimestamp as never).where(eq(pkColumn, id)).returning()
      return result[0] as TReturn
    })
  }

  override async doDelete(id: string | number, options?: PgRepositoryOptions): Promise<void> {
    const pkColumn = this.getPrimaryKeyColumn()
    const dbInstance = (options?.tx ?? this.db) as NodePgDatabase<TSchema>
    await dbInstance.delete(this.table as never).where(eq(pkColumn, id))
  }

  override async upsert<TData extends Record<string, unknown>, TReturn = InferredSelectModel<T>>(
    data: TData, options?: PgRepositoryOptions & { conflictColumns?: string[] },
  ): Promise<UpsertResult<TReturn>> {
    return this.execute(async () => {
      const dbInstance = (options?.tx ?? this.db) as NodePgDatabase<TSchema>
      const conflictColumns = options?.conflictColumns || ["id"]
      const now = Math.floor(Date.now() / 1000)
      const dataWithTimestamps = {
        ...data,
        ...(this.hasColumn("created_at") && { created_at: now }),
        ...(this.hasColumn("updated_at") && { updated_at: now }),
      }
      const whereConditions = conflictColumns.map((col) => {
        const column = Object.values(this.table).find((c) => (c as PgColumn).name === col)
        if (!column) throw new Error(`Column '${col}' not found in table`)
        return eq(column as PgColumn, data[col] as never)
      })
      const existing = (await dbInstance.select().from(this.table as never)
        .where(and(...whereConditions)).limit(1)) as TReturn[]
      if (existing.length > 0) {
        const updateData = { ...dataWithTimestamps }
        conflictColumns.forEach((col) => delete updateData[col])
        const updateResult = await dbInstance.update(this.table as never)
          .set(updateData as never).where(and(...whereConditions)).returning()
        return { entity: (updateResult as TReturn[])[0], previousEntity: existing[0] }
      }
      const insertResult = await dbInstance.insert(this.table as never).values({
        ...dataWithTimestamps,
        ...(this.hasColumn("id") && !dataWithTimestamps.id && { id: crypto.randomUUID() }),
      } as never).returning()
      return { entity: insertResult[0] as TReturn }
    })
  }

  override async count(params?: { where?: WhereCondition; tx?: PgTransaction<TSchema> }): Promise<number> {
    return this.execute(async () => {
      const { where, tx } = params || {}
      const dbInstance = (tx ?? this.db) as NodePgDatabase<TSchema>
      const whereCondition = where
        ? Array.isArray(where) ? and(...where) : where
        : undefined
      const base = dbInstance.select({ count: sql<number>`count(*)` })
        .from(this.table as never).$dynamic()
      const result = whereCondition ? await base.where(whereCondition) : await base
      const value = (result as { count: number }[])[0]?.count
      return typeof value === "number" ? value : Number(value) || 0
    })
  }

  protected getPrimaryKeyColumn(): PgColumn {
    const columns = Object.values(this.table) as PgColumn[]
    const pkColumn = columns.find((col) => col.primary)
    if (pkColumn) return pkColumn
    const idColumn = columns.find((col) => col.name === "id")
    if (idColumn) return idColumn
    const tableName = getTableName(this.table)
    throw new Error(`No primary key column found for table ${tableName}`)
  }

  protected hasColumn(columnName: string): boolean {
    return (Object.values(this.table) as PgColumn[]).some((col) => col.name === columnName)
  }

  protected handleError(err: unknown): Error {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : ""
    if (code === "23505") {
      const detail = err && typeof err === "object" && "detail" in err ? String((err as { detail: string }).detail) : ""
      const field = detail.includes("(") ? detail.replace(/^.*\(([^)]+)\).*$/, "$1").trim() : "field"
      return new DatabaseError("A record with this value already exists", { [field]: ["This value must be unique"] })
    }
    if (code === "23502") {
      const detail = err && typeof err === "object" && "detail" in err ? String((err as { detail: string }).detail) : "field"
      const field = detail.includes("(") ? detail.replace(/^.*\(([^)]+)\).*$/, "$1").trim() : "field"
      return new DatabaseError("Required field is missing", { [field]: ["This field is required"] })
    }
    if (code === "23503") {
      const detail = err && typeof err === "object" && "detail" in err ? String((err as { detail: string }).detail) : "field"
      const field = detail.includes("(") ? detail.replace(/^.*\(([^)]+)\).*$/, "$1").trim() : "field"
      return new DatabaseError("Referenced record does not exist", { [field]: ["Referenced record not found"] })
    }
    if (err instanceof Error) return new DatabaseError(err.message)
    return new DatabaseError("An unknown database error occurred")
  }
}
