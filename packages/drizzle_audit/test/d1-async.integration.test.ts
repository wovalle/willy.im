/**
 * Integration tests for withAudit against a real async D1 driver (miniflare v4).
 *
 * These tests exercise the actual failure mode described in issue #29:
 *   - drizzle-orm/d1 .all()/.run() return Promises, not plain values.
 *   - drizzle-orm/d1 db.transaction() issues a raw BEGIN which D1 rejects.
 *
 * All tests here FAIL on the current sync implementation and must PASS after the fix.
 *
 * The existing sqlite.integration.test.ts covers the better-sqlite3 (sync) path.
 */

import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import { asc, eq, isNull } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Miniflare } from "miniflare"

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

let mf: Miniflare

before(async () => {
  mf = new Miniflare({
    modules: true,
    script: `export default { fetch() { return new Response("ok") } }`,
    d1Databases: { DB: "drizzle-audit-test" },
  })
})

after(async () => {
  await mf.dispose()
})

async function setupDb() {
  const d1 = await mf.getD1Database("DB")
  // D1 exec() treats each newline as a statement separator — use prepare().run() for DDL
  for (const sql of [
    "DROP TABLE IF EXISTS audit_logs",
    "DROP TABLE IF EXISTS users",
    "DROP TABLE IF EXISTS invoices",
    "CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, operation TEXT NOT NULL, row_id TEXT, user_id TEXT, old_data TEXT, new_data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT)",
    "CREATE TABLE invoices (invoice_id TEXT PRIMARY KEY, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending')",
  ]) {
    await d1.prepare(sql).run()
  }
  return drizzle(d1, { schema: { auditLogs, users, invoices } })
}

test("withAudit insert logs audit row with new_data (real D1)", async () => {
  const db = await setupDb()
  const audited = withAudit(db, auditLogs, { userId: "user_1" })

  const row = await audited.insert(users, { id: "u1", name: "Ada", email: "ada@example.com" })

  assert.equal(row.id, "u1")
  assert.equal(row.name, "Ada")

  const logs = await db.select().from(auditLogs).all()
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
})

test("withAudit update captures old and new data (real D1)", async () => {
  const db = await setupDb()
  await db.insert(users).values({ id: "u1", name: "Ada", email: "ada@example.com" })

  const audited = withAudit(db, auditLogs, { userId: "user_2" })
  const rows = await audited.update(users, eq(users.id, "u1"), { name: "Ada Lovelace" })

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.name, "Ada Lovelace")

  const logs = await db.select().from(auditLogs).all()
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
})

test("withAudit delete captures old data (real D1)", async () => {
  const db = await setupDb()
  await db.insert(users).values({ id: "u1", name: "Ada" })

  const audited = withAudit(db, auditLogs, { userId: "user_3" })
  const deleted = await audited.delete(users, eq(users.id, "u1"))

  assert.equal(deleted.length, 1)
  assert.equal(deleted[0]?.id, "u1")

  const remaining = await db.select().from(users).all()
  assert.equal(remaining.length, 0)

  const logs = await db.select().from(auditLogs).all()
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
})

test("withAudit works with custom primary key column (real D1)", async () => {
  const db = await setupDb()
  const audited = withAudit(db, auditLogs, { userId: "user_1" })

  await audited.insert(invoices, { invoice_id: "inv_1", amount: 100 })
  await audited.update(invoices, eq(invoices.invoice_id, "inv_1"), { amount: 200 })
  await audited.delete(invoices, eq(invoices.invoice_id, "inv_1"))

  const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
  assert.equal(logs.length, 3)

  assert.equal(logs[0]?.table_name, "invoices")
  assert.equal(logs[0]?.row_id, "inv_1")

  assert.equal(logs[1]?.operation, "UPDATE")
  assert.equal(logs[1]?.row_id, "inv_1")
  assert.equal(JSON.parse(logs[1]?.old_data as string).amount, 100)
  assert.equal(JSON.parse(logs[1]?.new_data as string).amount, 200)

  assert.equal(logs[2]?.operation, "DELETE")
  assert.equal(logs[2]?.row_id, "inv_1")
})

test("withAudit handles multi-row update (real D1)", async () => {
  const db = await setupDb()
  await db.insert(users).values([
    { id: "u1", name: "Ada" },
    { id: "u2", name: "Bob" },
    { id: "u3", name: "Carol" },
  ])

  const audited = withAudit(db, auditLogs, { userId: "admin" })
  const rows = await audited.update(users, isNull(users.email), { email: "bulk@example.com" })

  assert.equal(rows.length, 3)

  const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all()
  assert.equal(logs.length, 3)

  for (const log of logs) {
    assert.equal(log.operation, "UPDATE")
    assert.equal(log.user_id, "admin")
    assert.equal(JSON.parse(log.new_data as string).email, "bulk@example.com")
  }
})

test("withAudit.db gives access to raw db for non-audited ops (real D1)", async () => {
  const db = await setupDb()
  const audited = withAudit(db, auditLogs, { userId: "user_1" })

  await audited.db.insert(users).values({ id: "u1", name: "Ada" })

  const logs = await db.select().from(auditLogs).all()
  assert.equal(logs.length, 0)

  const rows = await db.select().from(users).all()
  assert.equal(rows.length, 1)
})
