import assert from "node:assert/strict"
import test from "node:test"

import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { SqliteDrizzleRepository } from "../src/sqlite/drizzle_repository.js"
import { SqliteAuditLogRepository } from "../src/sqlite/audit_log.repository.js"
import { auditLogTable } from "../src/sqlite/audit-log-schema.js"
import { AuditableDrizzleRepository } from "../src/auditable_drizzle_repository.js"
import { AuditService } from "../src/audit_service.js"
import { DatabaseError } from "../src/base_drizzle_repository.js"

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  created_at: integer("created_at", { mode: "number" }),
  updated_at: integer("updated_at", { mode: "number" }),
})

type User = typeof usersTable.$inferSelect

const schema = { users: usersTable, auditLogs: auditLogTable }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDb() {
  const sqlite = new Database(":memory:")

  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      table_name TEXT,
      parent_id TEXT,
      user_id TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      is_system_event INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `)

  const db = drizzle({ client: sqlite, schema })
  return { db, sqlite }
}

function makeRepo(db: ReturnType<typeof drizzle<typeof schema>>) {
  return new SqliteDrizzleRepository(db as any, usersTable)
}

function makeAuditLogRepo(db: ReturnType<typeof drizzle<typeof schema>>) {
  return new SqliteAuditLogRepository(db as any, auditLogTable, schema as any)
}

// ============================================================================
// 1. Basic CRUD
// ============================================================================

test("create() generates UUID and timestamps", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    const user = await repo.create<Record<string, unknown>, User>({ name: "Alice", email: "alice@example.com" })

    assert.ok(user.id, "id should be generated")
    assert.match(user.id, /^[0-9a-f-]{36}$/, "id should be a UUID")
    assert.equal(user.name, "Alice")
    assert.equal(user.email, "alice@example.com")
    assert.ok(typeof user.created_at === "number", "created_at should be set")
    assert.ok(typeof user.updated_at === "number", "updated_at should be set")
  } finally {
    sqlite.close()
  }
})

test("findById() returns created entity", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    const created = await repo.create<Record<string, unknown>, User>({ name: "Bob", email: "bob@example.com" })
    const found = await repo.findById<User>(created.id)

    assert.ok(found)
    assert.equal(found.id, created.id)
    assert.equal(found.name, "Bob")
    assert.equal(found.email, "bob@example.com")
  } finally {
    sqlite.close()
  }
})

test("findMany() returns all entities", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    await repo.create({ name: "A", email: "a@example.com" })
    await repo.create({ name: "B", email: "b@example.com" })
    await repo.create({ name: "C", email: "c@example.com" })

    const all = await repo.findMany<User>()
    assert.equal(all.length, 3)
  } finally {
    sqlite.close()
  }
})

test("findMany() with pagination", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    for (let i = 0; i < 5; i++) {
      await repo.create({ name: `User${i}`, email: `user${i}@example.com` })
    }

    const page1 = await repo.findMany<User>({ pagination: { page: 1, limit: 2 } })
    assert.equal(page1.length, 2)

    const page2 = await repo.findMany<User>({ pagination: { page: 2, limit: 2 } })
    assert.equal(page2.length, 2)

    const page3 = await repo.findMany<User>({ pagination: { page: 3, limit: 2 } })
    assert.equal(page3.length, 1)
  } finally {
    sqlite.close()
  }
})

test("findOne() with where clause", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    await repo.create({ name: "Alice", email: "alice@example.com" })
    await repo.create({ name: "Bob", email: "bob@example.com" })

    const found = await repo.findOne<User>({ where: eq(usersTable.email, "bob@example.com") })
    assert.ok(found)
    assert.equal(found.name, "Bob")

    const notFound = await repo.findOne<User>({ where: eq(usersTable.email, "nobody@example.com") })
    assert.equal(notFound, undefined)
  } finally {
    sqlite.close()
  }
})

test("update() modifies entity and updates timestamp", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    const created = await repo.create<Record<string, unknown>, User>({ name: "Alice", email: "alice@example.com" })

    const updated = await repo.update<Record<string, unknown>, User>(created.id, { name: "Alice Updated" })

    assert.equal(updated.id, created.id)
    assert.equal(updated.name, "Alice Updated")
    assert.equal(updated.email, "alice@example.com")
    assert.ok(typeof updated.updated_at === "number", "updated_at should be set")
    assert.ok(updated.updated_at! >= created.updated_at!, "updated_at should be >= original")
  } finally {
    sqlite.close()
  }
})

test("delete() removes entity", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    const created = await repo.create<Record<string, unknown>, User>({ name: "Alice", email: "alice@example.com" })

    await repo.delete(created.id)

    const found = await repo.findById(created.id)
    assert.equal(found, undefined)
  } finally {
    sqlite.close()
  }
})

test("count() returns correct count", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    assert.equal(await repo.count(), 0)

    await repo.create({ name: "A", email: "a@example.com" })
    await repo.create({ name: "B", email: "b@example.com" })

    assert.equal(await repo.count(), 2)

    const countWithWhere = await repo.count({ where: eq(usersTable.name, "A") })
    assert.equal(countWithWhere, 1)
  } finally {
    sqlite.close()
  }
})

// ============================================================================
// 2. Upsert
// ============================================================================

test("upsert() inserts when entity does not exist (no previousEntity)", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    const id = crypto.randomUUID()
    const result = await repo.upsert<Record<string, unknown>, User>({ id, name: "New User", email: "new@example.com" })

    assert.equal(result.entity.id, id)
    assert.equal(result.entity.name, "New User")
    assert.equal(result.previousEntity, undefined, "previousEntity should be undefined for insert")

    const found = await repo.findById<User>(id)
    assert.ok(found)
    assert.equal(found.name, "New User")
  } finally {
    sqlite.close()
  }
})

test("upsert() updates when entity exists (has previousEntity)", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    const created = await repo.create<Record<string, unknown>, User>({ name: "Original", email: "orig@example.com" })

    const result = await repo.upsert<Record<string, unknown>, User>({ id: created.id, name: "Updated", email: "updated@example.com" })

    assert.equal(result.entity.id, created.id)
    assert.equal(result.entity.name, "Updated")
    assert.ok(result.previousEntity, "previousEntity should be defined for update")
    assert.equal(result.previousEntity!.name, "Original")
  } finally {
    sqlite.close()
  }
})

// ============================================================================
// 3. Error handling
// ============================================================================

test("create duplicate unique field throws DatabaseError", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)
    await repo.create({ name: "Alice", email: "alice@example.com" })

    await assert.rejects(
      () => repo.create({ name: "Alice2", email: "alice@example.com" }),
      (err: unknown) => {
        assert.ok(err instanceof DatabaseError, "should be a DatabaseError")
        assert.match(err.message, /unique|already exists/i)
        return true
      },
    )
  } finally {
    sqlite.close()
  }
})

test("create with missing required field throws DatabaseError", async () => {
  const { db, sqlite } = setupDb()
  try {
    const repo = makeRepo(db)

    await assert.rejects(
      // name is NOT NULL, so omitting it should fail
      () => repo.create({ email: "no-name@example.com" }),
      (err: unknown) => {
        assert.ok(err instanceof DatabaseError, "should be a DatabaseError")
        return true
      },
    )
  } finally {
    sqlite.close()
  }
})

// ============================================================================
// 4. AuditableDrizzleRepository + AuditService
// ============================================================================

function setupAuditable(db: ReturnType<typeof drizzle<typeof schema>>) {
  const repo = makeRepo(db)
  const auditLogRepo = makeAuditLogRepo(db)
  const auditService = new AuditService(auditLogRepo, { id: "test-user" }, "test-parent")
  const auditable = new AuditableDrizzleRepository<User>(repo as any, auditService)
  return { repo, auditLogRepo, auditService, auditable }
}

test("auditable create() logs audit entry", async () => {
  const { db, sqlite } = setupDb()
  try {
    const { auditable, auditLogRepo } = setupAuditable(db)
    const user = await auditable.create({ name: "Alice", email: "alice@example.com" })

    assert.ok(user.id)

    const logs = await auditLogRepo.findMany()
    assert.equal(logs.length, 1)

    const log = logs[0] as Record<string, unknown>
    assert.equal(log.event_type, "CREATE")
    assert.equal(log.entity_type, "users")
    assert.equal(log.entity_id, user.id)
    assert.equal(log.user_id, "test-user")
    assert.equal(log.parent_id, "test-parent")

    const details = JSON.parse(log.details as string)
    assert.ok(details.new_data, "details should contain new_data")
  } finally {
    sqlite.close()
  }
})

test("auditable update() logs audit with old/new data", async () => {
  const { db, sqlite } = setupDb()
  try {
    const { auditable, auditLogRepo } = setupAuditable(db)
    const user = await auditable.create({ name: "Alice", email: "alice@example.com" })

    await auditable.update(user.id, { name: "Alice Updated" })

    const logs = await auditLogRepo.findMany()
    // First log is CREATE, second is UPDATE
    assert.equal(logs.length, 2)

    const updateLog = logs.find((l: any) => l.event_type === "UPDATE") as Record<string, unknown>
    assert.ok(updateLog, "should have an UPDATE log")
    assert.equal(updateLog.entity_id, user.id)

    const details = JSON.parse(updateLog.details as string)
    assert.ok(details.old_data, "details should contain old_data")
    assert.ok(details.new_data, "details should contain new_data")
  } finally {
    sqlite.close()
  }
})

test("auditable delete() logs audit entry", async () => {
  const { db, sqlite } = setupDb()
  try {
    const { auditable, auditLogRepo } = setupAuditable(db)
    const user = await auditable.create({ name: "Alice", email: "alice@example.com" })

    await auditable.delete(user.id)

    const logs = await auditLogRepo.findMany()
    assert.equal(logs.length, 2) // CREATE + DELETE

    const deleteLog = logs.find((l: any) => l.event_type === "DELETE") as Record<string, unknown>
    assert.ok(deleteLog, "should have a DELETE log")
    assert.equal(deleteLog.entity_id, user.id)

    const details = JSON.parse(deleteLog.details as string)
    assert.ok(details.deleted_data, "details should contain deleted_data")
  } finally {
    sqlite.close()
  }
})

test("auditable upsert insert logs create audit", async () => {
  const { db, sqlite } = setupDb()
  try {
    const { auditable, auditLogRepo } = setupAuditable(db)
    const id = crypto.randomUUID()
    const user = await auditable.upsert({ id, name: "New", email: "new@example.com" })

    assert.equal(user.id, id)

    const logs = await auditLogRepo.findMany()
    assert.equal(logs.length, 1)

    const log = logs[0] as Record<string, unknown>
    assert.equal(log.event_type, "CREATE")
    assert.equal(log.entity_type, "users")
    assert.equal(log.entity_id, id)
  } finally {
    sqlite.close()
  }
})

test("auditable upsert update logs update audit", async () => {
  const { db, sqlite } = setupDb()
  try {
    const { auditable, auditLogRepo } = setupAuditable(db)
    const created = await auditable.create({ name: "Original", email: "orig@example.com" })

    await auditable.upsert({ id: created.id, name: "Updated", email: "updated@example.com" })

    const logs = await auditLogRepo.findMany()
    // CREATE from initial create + UPDATE from upsert
    assert.equal(logs.length, 2)

    const updateLog = logs.find((l: any) => l.event_type === "UPDATE") as Record<string, unknown>
    assert.ok(updateLog, "should have an UPDATE log")
    assert.equal(updateLog.entity_id, created.id)
    assert.equal(updateLog.entity_type, "users")

    const details = JSON.parse(updateLog.details as string)
    assert.ok(details.old_data, "details should contain old_data")
    assert.ok(details.new_data, "details should contain new_data")
  } finally {
    sqlite.close()
  }
})
