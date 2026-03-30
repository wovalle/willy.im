import type { AuditService } from "./audit_service.js"
import type { DrizzleRepositoryLike } from "./base_drizzle_repository.js"

type EntityWithId = { id: string | number }
type JsonSerializable = Record<string, unknown>

export class AuditableDrizzleRepository<TEntity = unknown> {
  constructor(
    private repo: DrizzleRepositoryLike,
    private auditService: AuditService,
  ) {}

  getEntityType(): string {
    return this.repo.getEntityType()
  }

  findMany(params?: unknown): Promise<TEntity[]> {
    return this.repo.findMany(params) as Promise<TEntity[]>
  }

  findOne(params: unknown): Promise<TEntity | undefined> {
    return this.repo.findOne(params) as Promise<TEntity | undefined>
  }

  findById(
    id: string | number,
    params?: unknown,
  ): Promise<TEntity | undefined> {
    return this.repo.findById(id, params) as Promise<TEntity | undefined>
  }

  count(params?: unknown): Promise<number> {
    return this.repo.count(params)
  }

  async create<TData extends Record<string, unknown>>(
    data: TData,
    options?: unknown,
  ): Promise<TEntity> {
    const result = (await this.repo.create(data, options)) as TEntity
    const entity = result as unknown as EntityWithId
    if (entity?.id) {
      await this.auditService.logEntityCreate(
        this.getEntityType(),
        entity.id.toString(),
        data as JsonSerializable,
      )
    }
    return result
  }

  async update<TData extends Record<string, unknown>>(
    id: string | number,
    data: TData,
    options?: unknown,
  ): Promise<TEntity> {
    const oldData = await this.repo.findById(id, options)
    const result = (await this.repo.update(id, data, options)) as TEntity
    if (oldData) {
      await this.auditService.logEntityUpdate(
        this.getEntityType(),
        id.toString(),
        oldData as JsonSerializable,
        data as JsonSerializable,
      )
    }
    return result
  }

  async delete(id: string | number, options?: unknown): Promise<void> {
    const item = await this.repo.findById(id, options)
    await this.repo.delete(id, options)
    if (item) {
      const entity = item as EntityWithId
      if (entity?.id) {
        await this.auditService.logEntityDelete(
          this.getEntityType(),
          entity.id.toString(),
          item as JsonSerializable,
        )
      }
    }
  }

  async upsert<TData extends Record<string, unknown>>(
    data: TData,
    options?: unknown & { conflictColumns?: string[] },
  ): Promise<TEntity> {
    const result = await this.repo.upsert(data, options)
    const entity = result.entity as unknown as EntityWithId
    if (entity?.id) {
      if (result.previousEntity != null) {
        await this.auditService.logEntityUpdate(
          this.getEntityType(),
          entity.id.toString(),
          result.previousEntity as JsonSerializable,
          result.entity as JsonSerializable,
        )
      } else {
        await this.auditService.logEntityCreate(
          this.getEntityType(),
          entity.id.toString(),
          result.entity as JsonSerializable,
        )
      }
    }
    return result.entity as TEntity
  }
}
