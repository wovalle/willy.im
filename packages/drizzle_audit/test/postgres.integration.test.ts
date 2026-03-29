import assert from "node:assert/strict"
import test from "node:test"

import { PGlite } from "@electric-sql/pglite"
import { asc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { integer, pgTable, text } from "drizzle-orm/pg-core"

import {
  createAttachAuditTriggersSql,
  createAuditInstallSql,
  pgAuditLogTable,
  withAuditedTransaction,
} from "../src/postgres/index.js"

const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
})

const invoices = pgTable("invoices", {
  invoice_id: text("invoice_id").primaryKey(),
  amount: integer("amount").notNull(),
})

const auditLogs = pgAuditLogTable()

test("postgres auditing works end to end", async () => {
  const client = new PGlite()
  const db = drizzle({
    client,
    schema: {
      auditLogs,
      users,
      invoices,
    },
  })

  try {
    await client.exec(createAuditInstallSql())
    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE invoices (
        invoice_id TEXT PRIMARY KEY,
        amount INTEGER NOT NULL
      );
    `)
    await client.exec(
      createAttachAuditTriggersSql([
        { table: "users" },
        { table: "invoices", rowIdColumn: "invoice_id" },
      ]),
    )

    // Insert without audit context should succeed with user_id = NULL
    await db.insert(users).values({ id: "user_0", name: "No Context" })

    const existingUsers = await db.select().from(users)
    assert.equal(existingUsers.length, 1)

    const noContextLogs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.equal(noContextLogs.length, 1)
    assert.equal(noContextLogs[0]?.user_id, null)
    assert.equal(noContextLogs[0]?.table_name, "users")
    assert.equal(noContextLogs[0]?.operation, "INSERT")

    await withAuditedTransaction(db, "user_123", async (tx) => {
      await tx.insert(users).values({ id: "user_1", name: "Ada" })
      await tx
        .update(users)
        .set({ name: "Ada Lovelace" })
        .where(eq(users.id, "user_1"))
      await tx.insert(invoices).values({ invoice_id: "inv_1", amount: 42 })
      await tx.delete(users).where(eq(users.id, "user_1"))
    })

    const logs = await db
      .select()
      .from(auditLogs)
      .orderBy(asc(auditLogs.id))

    assert.equal(logs.length, 5)

    assert.equal(logs[1]?.table_name, "users")
    assert.equal(logs[1]?.operation, "INSERT")
    assert.equal(logs[1]?.row_id, "user_1")
    assert.equal(logs[1]?.user_id, "user_123")
    assert.deepEqual(logs[1]?.new_data, { id: "user_1", name: "Ada" })

    assert.equal(logs[2]?.table_name, "users")
    assert.equal(logs[2]?.operation, "UPDATE")
    assert.equal(logs[2]?.row_id, "user_1")
    assert.deepEqual(logs[2]?.old_data, { id: "user_1", name: "Ada" })
    assert.deepEqual(logs[2]?.new_data, {
      id: "user_1",
      name: "Ada Lovelace",
    })

    assert.equal(logs[3]?.table_name, "invoices")
    assert.equal(logs[3]?.operation, "INSERT")
    assert.equal(logs[3]?.row_id, "inv_1")
    assert.deepEqual(logs[3]?.new_data, {
      invoice_id: "inv_1",
      amount: 42,
    })

    assert.equal(logs[4]?.table_name, "users")
    assert.equal(logs[4]?.operation, "DELETE")
    assert.equal(logs[4]?.row_id, "user_1")
    assert.deepEqual(logs[4]?.old_data, {
      id: "user_1",
      name: "Ada Lovelace",
    })
  } finally {
    await client.close()
  }
})

test("migration SQL bundle installs and enforces audit context", async () => {
  const client = new PGlite()
  const db = drizzle({
    client,
    schema: {
      auditLogs,
      users,
      invoices,
    },
  })

  try {
    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE invoices (
        invoice_id TEXT PRIMARY KEY,
        amount INTEGER NOT NULL
      );
    `)

    const migrationBundle = [
      createAuditInstallSql(),
      createAttachAuditTriggersSql([
        { table: "users" },
        { table: "invoices", rowIdColumn: "invoice_id" },
      ]),
    ].join("\n\n")
    await client.exec(migrationBundle)

    // Insert without audit context should succeed with user_id = NULL
    await db.insert(users).values({ id: "u_no_ctx", name: "No Context" })

    const noCtxLogs = await db.select().from(auditLogs)
    assert.equal(noCtxLogs.length, 1)
    assert.equal(noCtxLogs[0]?.user_id, null)
    assert.equal(noCtxLogs[0]?.operation, "INSERT")

    await withAuditedTransaction(db, "system:test", async (tx) => {
      await tx.insert(users).values({ id: "u", name: "With Context" })
    })

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.equal(logs.length, 2)
    assert.equal(logs[1]?.table_name, "users")
    assert.equal(logs[1]?.operation, "INSERT")
    assert.equal(logs[1]?.user_id, "system:test")
  } finally {
    await client.close()
  }
})

test("writes without audit context produce audit rows with user_id = NULL", async () => {
  const client = new PGlite()
  const db = drizzle({
    client,
    schema: {
      auditLogs,
      users,
    },
  })

  try {
    await client.exec(createAuditInstallSql())
    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    await client.exec(
      createAttachAuditTriggersSql([{ table: "users" }]),
    )

    // INSERT without audit context
    await db.insert(users).values({ id: "u1", name: "Alice" })

    // UPDATE without audit context
    await db.update(users).set({ name: "Alice Updated" }).where(eq(users.id, "u1"))

    // DELETE without audit context
    await db.delete(users).where(eq(users.id, "u1"))

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.equal(logs.length, 3)

    assert.equal(logs[0]?.operation, "INSERT")
    assert.equal(logs[0]?.user_id, null)
    assert.equal(logs[0]?.row_id, "u1")
    assert.deepEqual(logs[0]?.new_data, { id: "u1", name: "Alice" })

    assert.equal(logs[1]?.operation, "UPDATE")
    assert.equal(logs[1]?.user_id, null)
    assert.deepEqual(logs[1]?.old_data, { id: "u1", name: "Alice" })
    assert.deepEqual(logs[1]?.new_data, { id: "u1", name: "Alice Updated" })

    assert.equal(logs[2]?.operation, "DELETE")
    assert.equal(logs[2]?.user_id, null)
    assert.deepEqual(logs[2]?.old_data, { id: "u1", name: "Alice Updated" })
  } finally {
    await client.close()
  }
})

test("workspace_id column and context are stored when enabled", async () => {
  const client = new PGlite()
  const auditLogsWithWorkspace = pgAuditLogTable({ workspaceIdColumn: "workspace_id" })
  const db = drizzle({
    client,
    schema: {
      auditLogs: auditLogsWithWorkspace,
      users,
      invoices,
    },
  })

  try {
    await client.exec(
      createAuditInstallSql({ workspaceIdColumn: "workspace_id" }),
    )
    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    await client.exec(
      createAttachAuditTriggersSql([{ table: "users" }]),
    )

    await withAuditedTransaction(
      db,
      "user_1",
      async (tx) => {
        await tx.insert(users).values({ id: "u1", name: "Alice" })
      },
      "app.user_id",
      { workspaceId: "ws_1" },
    )

    const logs = await db.select().from(auditLogsWithWorkspace)
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.user_id, "user_1")
    assert.equal((logs[0] as { workspace_id?: string | null }).workspace_id, "ws_1")

    await withAuditedTransaction(db, "user_2", async (tx) => {
      await tx.insert(users).values({ id: "u2", name: "Bob" })
    })

    const logs2 = await db.select().from(auditLogsWithWorkspace).orderBy(asc(auditLogsWithWorkspace.id))
    assert.equal(logs2.length, 2)
    assert.equal(logs2[1]?.user_id, "user_2")
    assert.equal((logs2[1] as { workspace_id?: string | null }).workspace_id, null)
  } finally {
    await client.close()
  }
})
