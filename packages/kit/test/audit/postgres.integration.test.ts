import assert from "node:assert/strict"
import { test } from "vitest"

import { PGlite } from "@electric-sql/pglite"
import { asc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { integer, pgTable, text } from "drizzle-orm/pg-core"

import {
  createAttachAuditTriggerSql,
  createAttachAuditTriggersSql,
  createAuditAddContextColumnsSql,
  createAuditDropOperationCheckSql,
  createAuditInstallSql,
  pgAuditLogTable,
  recordAuditEvent,
  withAuditedTransaction,
} from "../../src/audit/postgres/index.js"

const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
})

const invoices = pgTable("invoices", {
  invoice_id: text("invoice_id").primaryKey(),
  amount: integer("amount").notNull(),
})

const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  last_seen_at: text("last_seen_at"),
  hits: integer("hits").notNull().default(0),
})

const auditLogs = pgAuditLogTable()

async function setupSessions(target: Parameters<typeof createAttachAuditTriggerSql>[0]) {
  const client = new PGlite()
  const db = drizzle({ client })
  await client.exec(createAuditInstallSql())
  await client.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_seen_at TEXT,
      hits INTEGER NOT NULL DEFAULT 0
    );
  `)
  await client.exec(createAttachAuditTriggerSql(target))
  return { client, db }
}

test("postgres auditing works end to end", async () => {
  const client = new PGlite()
  const db = drizzle({ client })

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
  const db = drizzle({ client })

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
  const db = drizzle({ client })

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
  const auditLogsWithWorkspace = pgAuditLogTable({
    contextColumns: [{ column: "workspace_id" }],
  })
  const db = drizzle({ client })

  try {
    await client.exec(
      createAuditInstallSql({ contextColumns: [{ column: "workspace_id" }] }),
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
      { context: { workspace_id: "ws_1" } },
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

test("custom context column name uses matching session key", async () => {
  const client = new PGlite()
  const auditLogsWithTenant = pgAuditLogTable({
    contextColumns: [{ column: "tenant_id" }],
  })
  const db = drizzle({ client })

  try {
    await client.exec(
      createAuditInstallSql({ contextColumns: [{ column: "tenant_id" }] }),
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

    // sessionKey defaults to "app.tenant_id"
    await withAuditedTransaction(
      db,
      "user_1",
      async (tx) => {
        await tx.insert(users).values({ id: "u1", name: "Alice" })
      },
      { context: { tenant_id: "tenant_abc" } },
    )

    const logs = await db.select().from(auditLogsWithTenant)
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.user_id, "user_1")
    assert.equal((logs[0] as Record<string, unknown>).tenant_id, "tenant_abc")
  } finally {
    await client.close()
  }
})

test("generic contextColumns populate and stay NULL without context", async () => {
  const client = new PGlite()
  const contextColumns = [
    { column: "workspace_id" },
    { column: "tenant_id" },
    { column: "request_id" },
  ]
  const auditLogsWithCtx = pgAuditLogTable({ contextColumns })
  const db = drizzle({ client })

  try {
    await client.exec(createAuditInstallSql({ contextColumns }))
    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    await client.exec(createAttachAuditTriggersSql([{ table: "users" }]))

    await withAuditedTransaction(
      db,
      "user_1",
      async (tx) => {
        await tx.insert(users).values({ id: "u1", name: "Alice" })
        await tx
          .update(users)
          .set({ name: "Alice Updated" })
          .where(eq(users.id, "u1"))
        await tx.delete(users).where(eq(users.id, "u1"))
      },
      {
        context: {
          workspace_id: "ws_1",
          tenant_id: "tenant_1",
          request_id: "req_1",
        },
      },
    )

    const logs = await db
      .select()
      .from(auditLogsWithCtx)
      .orderBy(asc(auditLogsWithCtx.id))
    assert.equal(logs.length, 3)
    for (const log of logs) {
      const row = log as Record<string, unknown>
      assert.equal(row.user_id, "user_1")
      assert.equal(row.workspace_id, "ws_1")
      assert.equal(row.tenant_id, "tenant_1")
      assert.equal(row.request_id, "req_1")
    }
    assert.equal(logs[0]?.operation, "INSERT")
    assert.equal(logs[1]?.operation, "UPDATE")
    assert.equal(logs[2]?.operation, "DELETE")

    // Write with NO context leaves all context columns NULL.
    await db.insert(users).values({ id: "u2", name: "No Context" })

    const allLogs = await db
      .select()
      .from(auditLogsWithCtx)
      .orderBy(asc(auditLogsWithCtx.id))
    const last = allLogs[allLogs.length - 1] as Record<string, unknown>
    assert.equal(last.user_id, null)
    assert.equal(last.workspace_id, null)
    assert.equal(last.tenant_id, null)
    assert.equal(last.request_id, null)
  } finally {
    await client.close()
  }
})

test("createAuditAddContextColumnsSql adds a column and regenerates trigger", async () => {
  const client = new PGlite()
  const auditLogsAfter = pgAuditLogTable({
    contextColumns: [{ column: "workspace_id" }, { column: "request_id" }],
  })
  const db = drizzle({ client })

  try {
    // 1) Install base table with a single context column.
    await client.exec(
      createAuditInstallSql({ contextColumns: [{ column: "workspace_id" }] }),
    )
    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    await client.exec(createAttachAuditTriggersSql([{ table: "users" }]))

    // 2) Migration: add request_id and regenerate the trigger over the full set.
    await client.exec(
      createAuditAddContextColumnsSql({
        contextColumns: [{ column: "workspace_id" }, { column: "request_id" }],
      }),
    )

    // 3) The regenerated trigger now populates the new column too.
    await withAuditedTransaction(
      db,
      "user_1",
      async (tx) => {
        await tx.insert(users).values({ id: "u1", name: "Alice" })
      },
      {
        context: {
          workspace_id: "ws_1",
          request_id: "req_99",
        },
      },
    )

    const logs = await db.select().from(auditLogsAfter)
    assert.equal(logs.length, 1)
    const row = logs[0] as Record<string, unknown>
    assert.equal(row.user_id, "user_1")
    assert.equal(row.workspace_id, "ws_1")
    assert.equal(row.request_id, "req_99")
  } finally {
    await client.close()
  }
})

test("custom context key for user_id works", async () => {
  const client = new PGlite()
  const db = drizzle({ client })

  try {
    await client.exec(
      createAuditInstallSql({ contextKey: "myapp.actor" }),
    )
    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    await client.exec(
      createAttachAuditTriggersSql(
        [{ table: "users" }],
        { contextKey: "myapp.actor" },
      ),
    )

    await withAuditedTransaction(
      db,
      "custom_user",
      async (tx) => {
        await tx.insert(users).values({ id: "u1", name: "Alice" })
      },
      { actorKey: "myapp.actor" },
    )

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.user_id, "custom_user")
  } finally {
    await client.close()
  }
})

test("install + attach SQL is idempotent — re-applying does not break or double-log", async () => {
  const client = new PGlite()
  const db = drizzle({ client })

  try {
    // Consumers ship the audit block in generated migrations, so a fresh
    // database replays it once per migration that carried it. Applying the
    // full install twice must be a no-op, not an error or a second trigger.
    const installSql = [
      createAuditInstallSql(),
      createAttachAuditTriggersSql([{ table: "users" }]),
    ].join("\n\n")

    await client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)
    await client.exec(installSql)
    await client.exec(installSql)
    await client.exec(installSql)

    await withAuditedTransaction(db, "user_1", async (tx) => {
      await tx.insert(users).values({ id: "u1", name: "Alice" })
    })

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.operation, "INSERT")

    const triggers = await client.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'users'::regclass AND NOT tgisinternal
       ORDER BY tgname`,
    )
    assert.deepEqual(
      triggers.rows.map((r) => r.tgname),
      ["users_audit", "users_audit_update"],
    )
  } finally {
    await client.close()
  }
})

test("ignoreColumns skips UPDATEs that touch only ignored columns", async () => {
  const { client, db } = await setupSessions({
    table: "sessions",
    ignoreColumns: ["last_seen_at", "hits", "hits"],
  })

  try {
    await db.insert(sessions).values({ id: "s1", name: "Ada" })
    // Heartbeat: only ignored columns change.
    await db
      .update(sessions)
      .set({ last_seen_at: "t1", hits: 1 })
      .where(eq(sessions.id, "s1"))
    // No-op on ignored columns plus a real change.
    await db
      .update(sessions)
      .set({ name: "Ada Lovelace", last_seen_at: "t2" })
      .where(eq(sessions.id, "s1"))
    await db.delete(sessions).where(eq(sessions.id, "s1"))

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.deepEqual(
      logs.map((l) => l.operation),
      ["INSERT", "UPDATE", "DELETE"],
    )
    assert.deepEqual(logs[1]?.old_data, { id: "s1", name: "Ada", last_seen_at: "t1", hits: 1 })
    assert.deepEqual(logs[1]?.new_data, {
      id: "s1",
      name: "Ada Lovelace",
      last_seen_at: "t2",
      hits: 1,
    })
  } finally {
    await client.close()
  }
})

test("onlyColumns logs only UPDATEs that change a listed column", async () => {
  const { client, db } = await setupSessions({ table: "sessions", onlyColumns: ["name"] })

  try {
    await db.insert(sessions).values({ id: "s1", name: "Ada" })
    await db
      .update(sessions)
      .set({ last_seen_at: "t1", hits: 1 })
      .where(eq(sessions.id, "s1"))
    await db
      .update(sessions)
      .set({ name: "Ada Lovelace", last_seen_at: "t2" })
      .where(eq(sessions.id, "s1"))
    await db.delete(sessions).where(eq(sessions.id, "s1"))

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.deepEqual(
      logs.map((l) => l.operation),
      ["INSERT", "UPDATE", "DELETE"],
    )
    assert.equal((logs[1]?.new_data as Record<string, unknown>).last_seen_at, "t2")
  } finally {
    await client.close()
  }
})

test("onlyColumns with several columns logs a change to any of them, NULL-safe", async () => {
  const { client, db } = await setupSessions({
    table: "sessions",
    onlyColumns: ["name", "last_seen_at"],
  })

  try {
    await db.insert(sessions).values({ id: "s1", name: "Ada" })
    await db.update(sessions).set({ hits: 1 }).where(eq(sessions.id, "s1"))
    await db.update(sessions).set({ last_seen_at: "t1" }).where(eq(sessions.id, "s1"))

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.deepEqual(
      logs.map((l) => l.operation),
      ["INSERT", "UPDATE"],
    )
  } finally {
    await client.close()
  }
})

test("ignoreColumns / onlyColumns validation", () => {
  assert.throws(
    () =>
      createAttachAuditTriggerSql({
        table: "sessions",
        ignoreColumns: ["hits"],
        onlyColumns: ["name"],
      }),
    /mutually exclusive/,
  )
  assert.throws(
    () => createAttachAuditTriggerSql({ table: "sessions", ignoreColumns: [] }),
    /ignoreColumns must contain at least one column/,
  )
  assert.throws(
    () => createAttachAuditTriggerSql({ table: "sessions", onlyColumns: [] }),
    /onlyColumns must contain at least one column/,
  )
  assert.throws(
    () => createAttachAuditTriggerSql({ table: "sessions", onlyColumns: [" "] }),
    /onlyColumns\[\] must not be empty/,
  )
})

test("ignoreColumns quotes awkward column names safely", async () => {
  const client = new PGlite()
  const db = drizzle({ client })

  try {
    await client.exec(createAuditInstallSql())
    await client.exec(`CREATE TABLE odd (id TEXT PRIMARY KEY, "it's, ""odd""" TEXT, name TEXT);`)
    await client.exec(
      createAttachAuditTriggerSql({ table: "odd", ignoreColumns: [`it's, "odd"`] }),
    )

    await client.exec(`INSERT INTO odd (id, name) VALUES ('o1', 'a');`)
    await client.exec(`UPDATE odd SET "it's, ""odd""" = 'x' WHERE id = 'o1';`)
    await client.exec(`UPDATE odd SET name = 'b' WHERE id = 'o1';`)

    const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    assert.deepEqual(
      logs.map((l) => l.operation),
      ["INSERT", "UPDATE"],
    )
  } finally {
    await client.close()
  }
})

test("recordAuditEvent logs a custom event with the transaction's context", async () => {
  const client = new PGlite()
  const contextColumns = [{ column: "workspace_id" }]
  const auditLogsWithCtx = pgAuditLogTable({ contextColumns })
  const db = drizzle({ client })

  try {
    await client.exec(createAuditInstallSql({ contextColumns }))

    await withAuditedTransaction(
      db,
      "user_1",
      async (tx) => {
        await recordAuditEvent(
          tx,
          { table: "member", operation: "invite", rowId: "m1", newData: { email: "a@b.c" } },
          { contextColumns },
        )
      },
      { context: { workspace_id: "ws_1" } },
    )
    await recordAuditEvent(db, { table: "api_key", operation: "revoke" })

    const logs = await db.select().from(auditLogsWithCtx).orderBy(asc(auditLogsWithCtx.id))
    assert.equal(logs.length, 2)
    const invite = logs[0] as Record<string, unknown>
    assert.equal(invite.table_name, "member")
    assert.equal(invite.operation, "invite")
    assert.equal(invite.row_id, "m1")
    assert.equal(invite.user_id, "user_1")
    assert.equal(invite.workspace_id, "ws_1")
    assert.equal(invite.old_data, null)
    assert.deepEqual(invite.new_data, { email: "a@b.c" })

    const revoke = logs[1] as Record<string, unknown>
    assert.equal(revoke.operation, "revoke")
    assert.equal(revoke.row_id, null)
    assert.equal(revoke.user_id, null)
    assert.equal(revoke.workspace_id, null)
    assert.equal(revoke.new_data, null)
  } finally {
    await client.close()
  }
})

test("recordAuditEvent rolls back with its transaction and validates input", async () => {
  const client = new PGlite()
  const db = drizzle({ client })

  try {
    await client.exec(createAuditInstallSql())

    await assert.rejects(
      withAuditedTransaction(db, "user_1", async (tx) => {
        await recordAuditEvent(tx, { table: "member", operation: "invite" })
        throw new Error("boom")
      }),
      /boom/,
    )
    await assert.rejects(recordAuditEvent(db, { table: " ", operation: "invite" }), /table/)
    await assert.rejects(recordAuditEvent(db, { table: "member", operation: "" }), /operation/)

    const logs = await db.select().from(auditLogs)
    assert.equal(logs.length, 0)
  } finally {
    await client.close()
  }
})

test("createAuditDropOperationCheckSql lets an old install accept custom operations", async () => {
  const client = new PGlite()
  const db = drizzle({ client })

  try {
    // Table as installed before custom events existed.
    await client.exec(`
      CREATE TABLE audit_logs (
        id BIGSERIAL PRIMARY KEY,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
        row_id TEXT,
        user_id TEXT,
        old_data JSONB,
        new_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
    await assert.rejects(recordAuditEvent(db, { table: "member", operation: "invite" }))

    await client.exec(createAuditDropOperationCheckSql())
    await client.exec(createAuditDropOperationCheckSql())
    await recordAuditEvent(db, { table: "member", operation: "invite" })

    const logs = await db.select().from(auditLogs)
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.operation, "invite")
  } finally {
    await client.close()
  }
})
