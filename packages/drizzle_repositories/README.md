# drizzle-repositories

Generic repository layer for [Drizzle ORM](https://orm.drizzle.team) with optional audit logging. Supports Postgres (node-postgres) and D1/SQLite.

## Install

```bash
npm install @wovalle/drizzle-repositories
```

Peer dependencies: `drizzle-orm` (^1.0.0-beta.15), `zod` (>=3.0.0).

## Quick Start (SQLite / D1)

```ts
import { SqliteDrizzleRepository } from "@wovalle/drizzle-repositories/sqlite"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { drizzle } from "drizzle-orm/d1"

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  created_at: integer("created_at"),
  updated_at: integer("updated_at"),
})

const db = drizzle(env.DB, { schema: { users } })
const userRepo = new SqliteDrizzleRepository(db, users)

// Create (auto-generates UUID id, sets created_at/updated_at as unix seconds)
const user = await userRepo.create({ name: "Ada" })

// Read
const all = await userRepo.findMany()
const one = await userRepo.findOne({ where: eq(users.name, "Ada") })
const byId = await userRepo.findById(user.id)

// Pagination
const page = await userRepo.findMany({
  pagination: { page: 2, limit: 20 },
  orderBy: [{ column: users.name, direction: "asc" }],
})

// Update (auto-sets updated_at)
const updated = await userRepo.update(user.id, { name: "Ada Lovelace" })

// Upsert
const { entity, previousEntity } = await userRepo.upsert(
  { id: user.id, name: "Ada L." },
  { conflictColumns: ["id"] },
)

// Delete
await userRepo.delete(user.id)

// Count
const total = await userRepo.count({ where: eq(users.name, "Ada") })
```

## Quick Start (Postgres)

```ts
import { PgDrizzleRepository } from "@wovalle/drizzle-repositories/postgres"
import { pgTable, text, integer } from "drizzle-orm/pg-core"

const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  created_at: integer("created_at"),
  updated_at: integer("updated_at"),
})

const db = drizzle(pool, { schema: { users } })
const userRepo = new PgDrizzleRepository(db, users)

// Same CRUD API as SQLite
const user = await userRepo.create({ name: "Ada" })
const found = await userRepo.findById(user.id)
await userRepo.update(user.id, { name: "Ada Lovelace" })
await userRepo.delete(user.id)
```

## Audit Logging

`AuditableDrizzleRepository` wraps any repository to automatically log create, update, and delete operations via `AuditService`.

```ts
import { AuditableDrizzleRepository, AuditService } from "@wovalle/drizzle-repositories"
import { PgAuditLogRepository, pgAuditLogTable } from "@wovalle/drizzle-repositories/postgres"

// 1. Add audit_logs table to your schema
export const auditLogs = pgAuditLogTable()

// 2. Create the audit service
const auditLogRepo = new PgAuditLogRepository(db, auditLogs, schema)
const auditService = new AuditService(auditLogRepo, { id: currentUser.id })

// Optionally scope logs to a parent entity (e.g. workspace)
// const auditService = new AuditService(auditLogRepo, { id: currentUser.id }, workspaceId)

// 3. Wrap your repository
const userRepo = new PgDrizzleRepository(db, users)
const auditedUsers = new AuditableDrizzleRepository(userRepo, auditService)

// All writes are now audit-logged
await auditedUsers.create({ name: "Ada" })
await auditedUsers.update(userId, { name: "Ada Lovelace" })
await auditedUsers.delete(userId)
```

`AuditService` also supports system events:

```ts
await auditService.logSystemEvent("MAINTENANCE", { reason: "schema migration" })
```

For SQLite, use `SqliteAuditLogRepository` and `auditLogTable` from the `/sqlite` export instead.

## Repository Factory (Postgres)

For apps with many tables, factory functions reduce boilerplate.

```ts
import {
  createRepositoryFactory,
  createAuditableRepositoryFactory,
  createAuditService,
  extendRepository,
} from "@wovalle/drizzle-repositories/postgres"

// Basic factory
const createRepository = createRepositoryFactory({ db })
const userRepo = createRepository(users)
const postRepo = createRepository(posts)

// Auditable factory
const auditService = createAuditService(db, { auditLogs }, currentUser, workspaceId)
const createAuditableRepository = createAuditableRepositoryFactory(auditService, { db })
const auditedUsers = createAuditableRepository(users)

// Extend with custom methods
const auditedPosts = createAuditableRepository(posts, ({ db, table, repo }) => ({
  async findByAuthor(authorId: string) {
    return repo.findMany({ where: eq(table.author_id, authorId) })
  },
}))

await auditedPosts.findByAuthor("u1") // custom method
await auditedPosts.create({ title: "Hello" }) // standard + audited
```

You can also extend a plain repository with `extendRepository`:

```ts
const base = new PgDrizzleRepository(db, users)
const extended = extendRepository(base, {
  findByEmail(email: string) {
    return base.findOne({ where: eq(users.email, email) })
  },
})
```

## Lifecycle Hooks

Subclass any repository to hook into the create/update/delete lifecycle. The base class uses the template method pattern: `create()` calls `beforeCreate` -> `doCreate` -> `afterCreate`.

```ts
class UserRepository extends PgDrizzleRepository<typeof schema, typeof users> {
  protected override async beforeCreate(data: Record<string, unknown>) {
    // Validate, transform, or enrich data before insert
  }

  protected override async afterCreate(result: unknown) {
    // Send welcome email, sync to external system, etc.
  }

  protected override async beforeUpdate(data: Record<string, unknown>) {}
  protected override async afterUpdate(result: unknown) {}
  protected override async beforeDelete(data: Record<string, unknown>) {}
  protected override async afterDelete(data: Record<string, unknown>) {}
}
```

## Error Handling

Database constraint violations are wrapped in `DatabaseError`, which includes structured `fieldErrors`:

```ts
import { DatabaseError } from "@wovalle/drizzle-repositories"

try {
  await userRepo.create({ email: "duplicate@example.com" })
} catch (err) {
  if (err instanceof DatabaseError) {
    console.log(err.fieldErrors)
    // { "users.email": ["This value must be unique"] }
  }
}
```

## API Reference

### `@wovalle/drizzle-repositories`

| Export | Description |
|---|---|
| `BaseDrizzleRepository` | Abstract base class with lifecycle hooks and template methods |
| `DatabaseError` | Error subclass with optional `fieldErrors` for constraint violations |
| `AuditableDrizzleRepository` | Decorator that adds audit logging to any `DrizzleRepositoryLike` |
| `AuditService` | Service for logging entity and system audit events |
| `auditLogSearchParamsSchema` | Zod schema for audit log search/filter params |

### `@wovalle/drizzle-repositories/sqlite`

| Export | Description |
|---|---|
| `SqliteDrizzleRepository` | SQLite/D1 repository implementation |
| `SqliteAuditLogRepository` | Audit log repository for SQLite/D1 |
| `auditLogTable` | Drizzle SQLite table definition for audit logs |

### `@wovalle/drizzle-repositories/postgres`

| Export | Description |
|---|---|
| `PgDrizzleRepository` | Postgres repository implementation |
| `PgAuditLogRepository` | Audit log repository for Postgres |
| `pgAuditLogTable` | Drizzle Postgres table definition for audit logs |
| `createRepositoryFactory(deps)` | Factory that returns a `createRepository(table, options?)` function |
| `createAuditableRepositoryFactory(auditService, deps)` | Factory for auditable repositories with optional custom methods |
| `createRepositoriesFactory(deps)` | Combined factory returning both `createRepository` and `createAuditableRepository` |
| `createAuditService(db, schema, user?, workspaceId?)` | Helper to wire up `AuditService` with `PgAuditLogRepository` |
| `extendRepository(repo, methods)` | Mixin custom methods onto an existing repository instance |

## License

MIT
