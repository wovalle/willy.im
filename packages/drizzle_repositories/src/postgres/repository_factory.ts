import type { InferSelectModel } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { AuditService } from "../audit_service.js"
import { AuditableDrizzleRepository } from "../auditable_drizzle_repository.js"
import { PgAuditLogRepository } from "./audit_log.repository.js"
import type { PgAuditLogSchema } from "./audit_log.repository.js"
import { PgDrizzleRepository } from "./drizzle_repository.js"
import type { PgDatabaseLike } from "./drizzle_repository.js"

export type CreateRepositoryOptions = { auditable?: boolean }

export type CustomRepositoryMethods = Record<string, (this: unknown, ...args: unknown[]) => unknown>

export function extendRepository<TRepo extends object, TCustom extends Record<string, (...args: any[]) => any>>(
  repo: TRepo, customMethods: TCustom,
): TRepo & TCustom {
  const result = Object.create(repo) as TRepo & TCustom
  for (const [key, value] of Object.entries(customMethods)) {
    ;(result as Record<string, unknown>)[key] = typeof value === "function" ? value.bind(repo) : value
  }
  return result
}

export function createRepositoryFactory<TSchema extends Record<string, unknown>>(
  deps: { db: PgDatabaseLike<TSchema>; auditService?: AuditService | null },
) {
  const { db, auditService } = deps

  function createRepository<T extends PgTable>(table: T, options?: { auditable?: false }): PgDrizzleRepository<TSchema, T>
  function createRepository<T extends PgTable>(table: T, options: { auditable: true }): AuditableDrizzleRepository<InferSelectModel<T>>
  function createRepository<T extends PgTable, TCustom extends CustomRepositoryMethods>(
    table: T, customMethods: TCustom,
  ): PgDrizzleRepository<TSchema, T> & TCustom
  function createRepository<T extends PgTable, TCustom extends CustomRepositoryMethods>(
    table: T, optionsOrCustom?: CreateRepositoryOptions | TCustom,
  ):
    | PgDrizzleRepository<TSchema, T>
    | AuditableDrizzleRepository<InferSelectModel<T>>
    | (PgDrizzleRepository<TSchema, T> & TCustom) {
    const base = new PgDrizzleRepository(db, table)
    const isCustomMethods = optionsOrCustom != null && typeof optionsOrCustom === "object" && !("auditable" in optionsOrCustom)
    if (isCustomMethods) return extendRepository(base, optionsOrCustom as TCustom)
    const options = optionsOrCustom as CreateRepositoryOptions | undefined
    return options?.auditable && auditService
      ? new AuditableDrizzleRepository<InferSelectModel<T>>(base, auditService)
      : base
  }

  return createRepository
}

export type AuditableRepositoryDeps<TDb, T extends PgTable> = {
  db: TDb
  table: T
  repo: AuditableDrizzleRepository<InferSelectModel<T>>
}

export type CustomMethodsCallback<TDb, T extends PgTable, TCustom extends Record<string, (...args: any[]) => any>> =
  (deps: AuditableRepositoryDeps<TDb, T>) => TCustom

export function createAuditableRepositoryFactory<TDb>(
  auditService: AuditService, deps: { db: TDb },
) {
  const { db } = deps

  function createAuditableRepository<T extends PgTable>(table: T): AuditableDrizzleRepository<InferSelectModel<T>>
  function createAuditableRepository<T extends PgTable, TCustom extends Record<string, (...args: any[]) => any>>(
    table: T, customMethodsCallback: CustomMethodsCallback<TDb, T, TCustom>,
  ): Omit<AuditableDrizzleRepository<InferSelectModel<T>>, keyof TCustom> & TCustom
  function createAuditableRepository<T extends PgTable, TCustom extends Record<string, (...args: any[]) => any>>(
    table: T, customMethodsCallback?: CustomMethodsCallback<TDb, T, TCustom>,
  ):
    | AuditableDrizzleRepository<InferSelectModel<T>>
    | (Omit<AuditableDrizzleRepository<InferSelectModel<T>>, keyof TCustom> & TCustom) {
    const base = new PgDrizzleRepository(db as PgDatabaseLike<Record<string, unknown>>, table)
    const auditable = new AuditableDrizzleRepository<InferSelectModel<T>>(base, auditService)
    if (customMethodsCallback != null) {
      const customMethods = customMethodsCallback({ db, table, repo: auditable })
      if (Object.keys(customMethods).length > 0) {
        return extendRepository(auditable, customMethods as CustomRepositoryMethods) as unknown as
          Omit<AuditableDrizzleRepository<InferSelectModel<T>>, keyof TCustom> & TCustom
      }
    }
    return auditable
  }

  return createAuditableRepository
}

export function createRepositoriesFactory<TDb>(deps: {
  db: TDb; auditService?: AuditService | null
}) {
  const { db, auditService } = deps
  const createRepository = createRepositoryFactory({ db: db as PgDatabaseLike<Record<string, unknown>> })
  const createAuditableRepository = auditService != null
    ? createAuditableRepositoryFactory(auditService, { db })
    : (table: PgTable) => {
        throw new Error("createAuditableRepository requires auditService in createRepositoriesFactory deps")
      }
  return { createRepository, createAuditableRepository }
}

export type CreateRepositoryFn<TSchema extends Record<string, unknown>> =
  ReturnType<typeof createRepositoryFactory<TSchema>>

export function createAuditService<TDb>(
  db: TDb,
  schema: { auditLogs: PgTable; user?: PgTable },
  user?: { id: string } | null,
  workspaceId?: string,
): AuditService {
  const auditLogRepo = new PgAuditLogRepository(
    db as PgDatabaseLike<PgAuditLogSchema>, schema.auditLogs, schema as PgAuditLogSchema,
  )
  return new AuditService(auditLogRepo, user ?? null, workspaceId)
}
