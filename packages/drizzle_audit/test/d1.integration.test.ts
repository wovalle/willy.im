import assert from "node:assert/strict"
import test from "node:test"

import Database from "better-sqlite3"
import { asc, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

import {
  createAttachD1AuditTriggersSql,
  createAttachD1AuditTriggersSqlWithColumns,
  createD1AuditInstallSql,
  d1AuditLogTable,
  d1AuditContextTable,
  withD1AuditedTransaction,
} from "../src/d1/index.js"

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
})

const invoices = sqliteTable("invoices", {
  invoice_id: text("invoice_id").primaryKey(),
  amount: integer("amount").notNull(),
})

const auditLogs = d1AuditLogTable()
const auditContext = d1AuditContextTable()

function setupDb() {
  const sqlite = new Database(":memory:")
  const db = drizzle({ client: sqlite, schema: { auditLogs, auditContext, users, invoices } })

  sqlite.exec(createD1AuditInstallSql())
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE invoices (
      invoice_id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL
    );
  `)
  sqlite.exec(
    createAttachD1AuditTriggersSql([
      { table: "users" },
      { table: "invoices", rowIdColumn: "invoice_id" },
    ]),
  )

  return { db, sqlite }
}

test("d1 auditing works end to end (without row data)", () => {
  const { db, sqlite } = setupDb()

  try {
    // Insert without audit context: user_id = NULL
    db.insert(users).values({ id: "user_0", name: "No Context" }).run()

    const noContextLogs = db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
    assert.equal(noContextLogs.length, 1)
    assert.equal(noContextLogs[0]?.user_id, null)
    assert.equal(noContextLogs[0]?.table_name, "users")
    assert.equal(noContextLogs[0]?.operation, "INSERT")
    assert.equal(noContextLogs[0]?.row_id, "user_0")

    // With audit context
    withD1AuditedTransaction(db, "user_123", (tx) => {
      tx.insert(users).values({ id: "user_1", name: "Ada" }).run()
      tx.update(users).set({ name: "Ada Lovelace" }).where(eq(users.id, "user_1")).run()
      tx.insert(invoices).values({ invoice_id: "inv_1", amount: 42 }).run()
      tx.delete(users).where(eq(users.id, "user_1")).run()
    })

    const logs = db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
    assert.equal(logs.length, 5)

    // INSERT user
    assert.equal(logs[1]?.table_name, "users")
    assert.equal(logs[1]?.operation, "INSERT")
    assert.equal(logs[1]?.row_id, "user_1")
    assert.equal(logs[1]?.user_id, "user_123")

    // UPDATE user
    assert.equal(logs[2]?.table_name, "users")
    assert.equal(logs[2]?.operation, "UPDATE")
    assert.equal(logs[2]?.row_id, "user_1")
    assert.equal(logs[2]?.user_id, "user_123")

    // INSERT invoice (custom rowIdColumn)
    assert.equal(logs[3]?.table_name, "invoices")
    assert.equal(logs[3]?.operation, "INSERT")
    assert.equal(logs[3]?.row_id, "inv_1")

    // DELETE user
    assert.equal(logs[4]?.table_name, "users")
    assert.equal(logs[4]?.operation, "DELETE")
    assert.equal(logs[4]?.row_id, "user_1")
    assert.equal(logs[4]?.user_id, "user_123")

    // Context table should be clean after transaction
    const contextRows = db.select().from(auditContext).all()
    assert.equal(contextRows.length, 0)
  } finally {
    sqlite.close()
  }
})

test("d1 column-aware triggers capture full row data", () => {
  const sqlite = new Database(":memory:")
  const db = drizzle({ client: sqlite, schema: { auditLogs, auditContext, users } })

  try {
    sqlite.exec(createD1AuditInstallSql())
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    sqlite.exec(
      createAttachD1AuditTriggersSqlWithColumns([
        { table: "users", columns: ["id", "name"] },
      ]),
    )

    withD1AuditedTransaction(db, "user_1", (tx) => {
      tx.insert(users).values({ id: "u1", name: "Ada" }).run()
      tx.update(users).set({ name: "Ada Lovelace" }).where(eq(users.id, "u1")).run()
      tx.delete(users).where(eq(users.id, "u1")).run()
    })

    const logs = db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
    assert.equal(logs.length, 3)

    // INSERT: new_data captured
    assert.equal(logs[0]?.operation, "INSERT")
    assert.deepEqual(JSON.parse(logs[0]?.new_data as string), { id: "u1", name: "Ada" })
    assert.equal(logs[0]?.old_data, null)

    // UPDATE: old_data and new_data captured
    assert.equal(logs[1]?.operation, "UPDATE")
    assert.deepEqual(JSON.parse(logs[1]?.old_data as string), { id: "u1", name: "Ada" })
    assert.deepEqual(JSON.parse(logs[1]?.new_data as string), { id: "u1", name: "Ada Lovelace" })

    // DELETE: old_data captured
    assert.equal(logs[2]?.operation, "DELETE")
    assert.deepEqual(JSON.parse(logs[2]?.old_data as string), { id: "u1", name: "Ada Lovelace" })
    assert.equal(logs[2]?.new_data, null)
  } finally {
    sqlite.close()
  }
})

test("d1 workspace_id column and context are stored when enabled", () => {
  const sqlite = new Database(":memory:")
  const auditLogsWithWorkspace = d1AuditLogTable({ workspaceIdColumn: "workspace_id" })
  const db = drizzle({ client: sqlite, schema: { auditLogs: auditLogsWithWorkspace, auditContext, users } })

  try {
    sqlite.exec(createD1AuditInstallSql({ workspaceIdColumn: "workspace_id" }))
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    sqlite.exec(
      createAttachD1AuditTriggersSql(
        [{ table: "users" }],
        { workspaceIdColumn: "workspace_id" },
      ),
    )

    withD1AuditedTransaction(
      db,
      "user_1",
      (tx) => {
        tx.insert(users).values({ id: "u1", name: "Alice" }).run()
      },
      { workspaceId: "ws_1" },
    )

    const logs = db.select().from(auditLogsWithWorkspace).all()
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.user_id, "user_1")
    assert.equal((logs[0] as Record<string, unknown>).workspace_id, "ws_1")

    // Without workspace
    withD1AuditedTransaction(db, "user_2", (tx) => {
      tx.insert(users).values({ id: "u2", name: "Bob" }).run()
    })

    const logs2 = db
      .select()
      .from(auditLogsWithWorkspace)
      .orderBy(asc(auditLogsWithWorkspace.id))
      .all()
    assert.equal(logs2.length, 2)
    assert.equal(logs2[1]?.user_id, "user_2")
    assert.equal((logs2[1] as Record<string, unknown>).workspace_id, null)
  } finally {
    sqlite.close()
  }
})

test("d1 writes without audit context produce rows with user_id = NULL", () => {
  const { db, sqlite } = setupDb()

  try {
    db.insert(users).values({ id: "u1", name: "Alice" }).run()
    db.update(users).set({ name: "Alice Updated" }).where(eq(users.id, "u1")).run()
    db.delete(users).where(eq(users.id, "u1")).run()

    const logs = db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
    assert.equal(logs.length, 3)

    assert.equal(logs[0]?.operation, "INSERT")
    assert.equal(logs[0]?.user_id, null)
    assert.equal(logs[0]?.row_id, "u1")

    assert.equal(logs[1]?.operation, "UPDATE")
    assert.equal(logs[1]?.user_id, null)

    assert.equal(logs[2]?.operation, "DELETE")
    assert.equal(logs[2]?.user_id, null)
  } finally {
    sqlite.close()
  }
})

test("d1 trigger SQL handles table names with special characters", () => {
  const sqlite = new Database(":memory:")
  const db = drizzle({ client: sqlite, schema: { auditLogs, auditContext } })

  try {
    sqlite.exec(createD1AuditInstallSql())
    // Table name with a single quote — the quoteLiteral fix prevents SQL breakage
    const tableName = "user's_data"
    sqlite.exec(`CREATE TABLE "${tableName}" (id TEXT PRIMARY KEY, val TEXT);`)
    sqlite.exec(
      createAttachD1AuditTriggersSql([{ table: tableName }]),
    )

    // Seed context and insert
    withD1AuditedTransaction(db, "tester", (tx) => {
      tx.run(sql`INSERT INTO "${sql.raw(tableName)}" (id, val) VALUES ('r1', 'hello')`)
    })

    const logs = db.select().from(auditLogs).all()
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.table_name, tableName)
    assert.equal(logs[0]?.row_id, "r1")
    assert.equal(logs[0]?.user_id, "tester")
  } finally {
    sqlite.close()
  }
})

test("d1 column-aware triggers handle column names with special characters", () => {
  const sqlite = new Database(":memory:")
  const db = drizzle({ client: sqlite, schema: { auditLogs, auditContext } })

  try {
    sqlite.exec(createD1AuditInstallSql())
    sqlite.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, "user's name" TEXT);`)
    sqlite.exec(
      createAttachD1AuditTriggersSqlWithColumns([
        { table: "items", columns: ["id", "user's name"] },
      ]),
    )

    withD1AuditedTransaction(db, "tester", (tx) => {
      tx.run(sql`INSERT INTO items (id, "user's name") VALUES ('i1', 'Ada')`)
    })

    const logs = db.select().from(auditLogs).all()
    assert.equal(logs.length, 1)
    const newData = JSON.parse(logs[0]?.new_data as string)
    assert.equal(newData["user's name"], "Ada")
  } finally {
    sqlite.close()
  }
})
