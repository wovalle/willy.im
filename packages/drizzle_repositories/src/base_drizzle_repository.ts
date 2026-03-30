import { getTableName, type SQL, type Table } from "drizzle-orm"

export type PaginationParams = {
  page?: number
  limit?: number
}

export type WhereCondition = SQL | SQL[]

export class DatabaseError extends Error {
  fieldErrors?: Record<string, string[]>

  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = "DatabaseError"
    this.fieldErrors = fieldErrors
  }
}

export type BaseDrizzleRepositorySchema = Record<string, unknown>

export type BaseRepositoryOptions = { tx?: unknown }

export type UpsertResult<T = unknown> = {
  entity: T
  previousEntity?: T
}

export interface DrizzleRepositoryLike {
  getEntityType(): string
  findMany(params?: unknown): Promise<unknown[]>
  findOne(params: unknown): Promise<unknown | undefined>
  findById(id: string | number, params?: unknown): Promise<unknown | undefined>
  create(data: Record<string, unknown>, options?: unknown): Promise<unknown>
  update(
    id: string | number,
    data: Record<string, unknown>,
    options?: unknown,
  ): Promise<unknown>
  delete(id: string | number, options?: unknown): Promise<void>
  count(params?: unknown): Promise<number>
  upsert(
    data: Record<string, unknown>,
    options?: unknown & { conflictColumns?: string[] },
  ): Promise<UpsertResult>
}

export abstract class BaseDrizzleRepository<
  TSchema extends BaseDrizzleRepositorySchema,
  TTable extends Table,
  TOptions extends BaseRepositoryOptions = BaseRepositoryOptions,
> {
  protected abstract db: unknown
  protected abstract table: TTable

  getEntityType(): string {
    return getTableName(this.table)
  }

  // --- Lifecycle hooks (no-op by default) ---
  protected async beforeCreate(_data: Record<string, unknown>): Promise<void> {}
  protected async afterCreate(_data: unknown): Promise<void> {}
  protected async beforeUpdate(_data: Record<string, unknown>): Promise<void> {}
  protected async afterUpdate(_data: unknown): Promise<void> {}
  protected async beforeDelete(_data: Record<string, unknown>): Promise<void> {}
  protected async afterDelete(_data: Record<string, unknown>): Promise<void> {}

  // --- Error handling ---
  protected abstract handleError(err: unknown): Error

  protected async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw this.handleError(err)
    }
  }

  // --- Abstract read/write (dialect implements these) ---
  abstract findMany<TReturn = unknown>(params?: {
    where?: WhereCondition
    pagination?: PaginationParams
    orderBy?: unknown
    tx?: TOptions["tx"]
  }): Promise<TReturn[]>

  abstract findOne<TReturn = unknown>(params: {
    where: WhereCondition | undefined
    tx?: TOptions["tx"]
  }): Promise<TReturn | undefined>

  abstract findById<TReturn = unknown>(
    id: string | number,
    params?: { tx?: TOptions["tx"] },
  ): Promise<TReturn | undefined>

  abstract count(params?: {
    where?: WhereCondition
    tx?: TOptions["tx"]
  }): Promise<number>

  abstract doCreate<TData extends Record<string, unknown>, TReturn = unknown>(
    data: TData,
    options?: TOptions,
  ): Promise<TReturn>

  abstract doUpdate<TData extends Record<string, unknown>, TReturn = unknown>(
    id: string | number,
    data: TData,
    options?: TOptions,
  ): Promise<TReturn>

  abstract doDelete(id: string | number, options?: TOptions): Promise<void>

  abstract upsert<TData extends Record<string, unknown>, TReturn = unknown>(
    data: TData,
    options?: TOptions & { conflictColumns?: string[] },
  ): Promise<UpsertResult<TReturn>>

  // --- Template methods (call lifecycle + do*) ---
  async create<TData extends Record<string, unknown>, TReturn = unknown>(
    data: TData,
    options?: TOptions,
  ): Promise<TReturn> {
    await this.beforeCreate(data)
    const result = await this.doCreate<TData, TReturn>(data, options)
    await this.afterCreate(result)
    return result
  }

  async update<TData extends Record<string, unknown>, TReturn = unknown>(
    id: string | number,
    data: TData,
    options?: TOptions,
  ): Promise<TReturn> {
    await this.beforeUpdate(data)
    const result = await this.doUpdate<TData, TReturn>(id, data, options)
    await this.afterUpdate(result)
    return result
  }

  async delete(id: string | number, options?: TOptions): Promise<void> {
    const item = await this.findById(id, options as { tx?: TOptions["tx"] })
    if (item) {
      await this.beforeDelete(item as unknown as Record<string, unknown>)
    }
    await this.doDelete(id, options)
    if (item) {
      await this.afterDelete(item as unknown as Record<string, unknown>)
    }
  }
}
