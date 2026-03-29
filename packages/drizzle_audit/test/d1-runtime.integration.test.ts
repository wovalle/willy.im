import assert from "node:assert/strict"
import test from "node:test"

import Database from "better-sqlite3"
import { asc, eq, isNull } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

import { d1AuditLogTable } from "../src/d1/index.js"
import { withAudit } from "../src/d1-runtime/index.js"

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
})

const invoices = sqliteTable("invoices", {
  invoice_id: text("invoice_id").primaryKey(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("pending"),
})

const auditLogs = d1AuditLogTable()

function setupDb() {
  const sqlite = new Database(":memory:")
  const db = drizzle({ client: sqlite, schema: { auditLogs, users, invoices } })

  sqlite.exec(`
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      row_id TEXT,
      user_id TEXT,
      old_data TEXT,
      new_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT
    );
    CREATE TABLE invoices (
      invoice_id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
  `)

  return { db, sqlite }
}

test("withAudit insert logs audit row with new_data", () => {
  const { db, sqlite } = setupDb()
  try {
    const audited = withAudit(db, auditLogs, { userId: "user_1" })

    const row = audited.insert(users, { id: "u1", name: "Ada", email: "ada@example.com" })
    assert.equal(row.id, "u1")
    assert.equal(row.name, "Ada")

    const logs = db.select().from(auditLogs).all()
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.table_name, "users")
    assert.equal(logs[0]?.operation, "INSERT")
    assert.equal(logs[0]?.row_id, "u1")
    assert.equal(logs[0]?.user_id, "user_1")
    assert.equal(logs[0]?.old_data, null)
    assert.deepEqual(JSON.parse(logs[0]?.new_data as string), {
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
    })
  } finally {
    sqlite.close()
  }
})

test("withAudit update captures old and new data", () => {
  const { db, sqlite } = setupDb()
  try {
    // Seed a row
    db.insert(users).values({ id: "u1", name: "Ada", email: "ada@example.com" }).run()

    const audited = withAudit(db, auditLogs, { userId: "user_2" })
    const rows = audited.update(users, eq(users.id, "u1"), { name: "Ada Lovelace" })

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.name, "Ada Lovelace")

    const logs = db.select().from(auditLogs).all()
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.operation, "UPDATE")
    assert.equal(logs[0]?.row_id, "u1")
    assert.equal(logs[0]?.user_id, "user_2")

    const oldData = JSON.parse(logs[0]?.old_data as string)
    assert.equal(oldData.name, "Ada")
    assert.equal(oldData.email, "ada@example.com")

    const newData = JSON.parse(logs[0]?.new_data as string)
    assert.equal(newData.name, "Ada Lovelace")
    assert.equal(newData.email, "ada@example.com")
  } finally {
    sqlite.close()
  }
})

test("withAudit delete captures old data", () => {
  const { db, sqlite } = setupDb()
  try {
    db.insert(users).values({ id: "u1", name: "Ada" }).run()

    const audited = withAudit(db, auditLogs, { userId: "user_3" })
    const deleted = audited.delete(users, eq(users.id, "u1"))

    assert.equal(deleted.length, 1)
    assert.equal(deleted[0]?.id, "u1")

    // Verify row is gone
    const remaining = db.select().from(users).all()
    assert.equal(remaining.length, 0)

    // Verify audit log
    const logs = db.select().from(auditLogs).all()
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.operation, "DELETE")
    assert.equal(logs[0]?.row_id, "u1")
    assert.equal(logs[0]?.user_id, "user_3")
    assert.deepEqual(JSON.parse(logs[0]?.old_data as string), {
      id: "u1",
      name: "Ada",
      email: null,
    })
    assert.equal(logs[0]?.new_data, null)
  } finally {
    sqlite.close()
  }
})

test("withAudit works with custom primary key column", () => {
  const { db, sqlite } = setupDb()
  try {
    const audited = withAudit(db, auditLogs, { userId: "user_1" })

    audited.insert(invoices, { invoice_id: "inv_1", amount: 100 })
    audited.update(invoices, eq(invoices.invoice_id, "inv_1"), { amount: 200 })
    audited.delete(invoices, eq(invoices.invoice_id, "inv_1"))

    const logs = db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
    assert.equal(logs.length, 3)

    assert.equal(logs[0]?.table_name, "invoices")
    assert.equal(logs[0]?.row_id, "inv_1")

    assert.equal(logs[1]?.operation, "UPDATE")
    assert.equal(logs[1]?.row_id, "inv_1")
    assert.equal(JSON.parse(logs[1]?.old_data as string).amount, 100)
    assert.equal(JSON.parse(logs[1]?.new_data as string).amount, 200)

    assert.equal(logs[2]?.operation, "DELETE")
    assert.equal(logs[2]?.row_id, "inv_1")
  } finally {
    sqlite.close()
  }
})

test("withAudit handles multi-row update", () => {
  const { db, sqlite } = setupDb()
  try {
    db.insert(users).values([
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
    ]).run()

    const audited = withAudit(db, auditLogs, { userId: "admin" })
    // Update all users (no where = all rows, but let's use a broader condition)
    const rows = audited.update(users, isNull(users.email), { email: "bulk@example.com" })

    assert.equal(rows.length, 3)

    const logs = db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
    assert.equal(logs.length, 3)

    for (const log of logs) {
      assert.equal(log.operation, "UPDATE")
      assert.equal(log.user_id, "admin")
      const newData = JSON.parse(log.new_data as string)
      assert.equal(newData.email, "bulk@example.com")
    }
  } finally {
    sqlite.close()
  }
})

test("withAudit with workspace_id", () => {
  const sqlite = new Database(":memory:")
  const auditLogsWithWs = d1AuditLogTable({ workspaceIdColumn: "workspace_id" })
  const db = drizzle({ client: sqlite, schema: { auditLogs: auditLogsWithWs, users } })

  try {
    sqlite.exec(`
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        row_id TEXT,
        user_id TEXT,
        workspace_id TEXT,
        old_data TEXT,
        new_data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
    `)

    const audited = withAudit(db, auditLogsWithWs, {
      userId: "user_1",
      workspaceId: "ws_1",
    })
    audited.insert(users, { id: "u1", name: "Ada" })

    const logs = db.select().from(auditLogsWithWs).all()
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.user_id, "user_1")
    assert.equal((logs[0] as Record<string, unknown>).workspace_id, "ws_1")
  } finally {
    sqlite.close()
  }
})

test("withAudit.db gives access to raw db for non-audited ops", () => {
  const { db, sqlite } = setupDb()
  try {
    const audited = withAudit(db, auditLogs, { userId: "user_1" })

    // Direct insert — no audit
    audited.db.insert(users).values({ id: "u1", name: "Ada" }).run()

    const logs = db.select().from(auditLogs).all()
    assert.equal(logs.length, 0)

    const rows = db.select().from(users).all()
    assert.equal(rows.length, 1)
  } finally {
    sqlite.close()
  }
})
