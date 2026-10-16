import assert from "node:assert/strict"
import { test } from "vitest"
import { z } from "zod"

import { PGlite } from "@electric-sql/pglite"
import { asc } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { pgTable, text } from "drizzle-orm/pg-core"

import { runWithAuditContext, recordEvent } from "../../src/audit/context/index.js"
import { defineAuditEvents } from "../../src/audit/events.js"
import {
  createAttachAuditTriggersSql,
  createAuditEventsInstallSql,
  createAuditInstallSql,
  listAuditEvents,
  pgAuditEventsTable,
  pgAuditLogTable,
  recordAuditEvent,
  withAuditedTransaction,
} from "../../src/audit/postgres/index.js"

const members = pgTable("members", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
})

const contextColumns = [{ column: "workspace_id" }]
const auditLogs = pgAuditLogTable({ contextColumns })
const auditEvents = pgAuditEventsTable({ contextColumns })

const events = defineAuditEvents({
  "member.invite": z.object({ email: z.email(), role: z.enum(["admin", "member"]).default("member") }),
  "api_key.create": z.object({ keyId: z.string() }),
  "api_key.revoke": z.object({ keyId: z.string(), reason: z.string().optional() }),
  "api1key.create": z.object({ keyId: z.string() }),
})

async function makeDb() {
  const client = new PGlite()
  const db = drizzle({ client })
  await client.exec(createAuditInstallSql({ contextColumns }))
  await client.exec(createAuditEventsInstallSql({ contextColumns }))
  await client.exec(`
    CREATE TABLE members (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    );
  `)
  await client.exec(createAttachAuditTriggersSql([{ table: "members" }]))
  return { client, db }
}

test("defineAuditEvents rejects bad names", () => {
  for (const name of ["", "Member.invite", "member..invite", ".invite", "member.", "member-invite", "member invite"]) {
    assert.throws(() => defineAuditEvents({ [name]: z.object({}) }), /invalid audit event name/, name)
  }
  assert.doesNotThrow(() => defineAuditEvents({ "a.b_c.d1": z.object({}), single: z.null() }))
})

test("recordAuditEvent inside withAuditedTransaction stores actor, context, subject and parsed data", async () => {
  const { db } = await makeDb()

  await withAuditedTransaction(
    db,
    "user_1",
    async (tx) => {
      await tx.insert(members).values({ id: "m1", email: "ada@example.com" })
      await recordAuditEvent(tx, events, "member.invite", {
        subject: { type: "workspace", id: "ws_1" },
        data: { email: "ada@example.com" },
      }, { contextColumns })
    },
    { context: { workspace_id: "ws_1" } },
  )

  const rows = await db.select().from(auditEvents)
  assert.equal(rows.length, 1)
  const row = rows[0]!
  assert.equal(row.name, "member.invite")
  assert.equal(row.subject_type, "workspace")
  assert.equal(row.subject_id, "ws_1")
  assert.equal(row.user_id, "user_1")
  assert.equal((row as Record<string, unknown>).workspace_id, "ws_1")
  // Parsed output: the default is applied.
  assert.deepEqual(row.data, { email: "ada@example.com", role: "member" })
  assert.ok(row.created_at instanceof Date)

  // The row change still goes to audit_logs, attributed the same way.
  const logs = await db.select().from(auditLogs)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.user_id, "user_1")
})

test("recordAuditEvent without context stores NULL actor and context", async () => {
  const { db } = await makeDb()
  await recordAuditEvent(db, events, "api_key.create", { data: { keyId: "k1" } }, { contextColumns })

  const [row] = await db.select().from(auditEvents)
  assert.equal(row?.user_id, null)
  assert.equal((row as Record<string, unknown>).workspace_id, null)
  assert.equal(row?.subject_type, null)
  assert.equal(row?.subject_id, null)
})

test("invalid payload throws and writes nothing; the transaction rolls back", async () => {
  const { db } = await makeDb()

  await assert.rejects(
    withAuditedTransaction(db, "user_1", async (tx) => {
      await tx.insert(members).values({ id: "m1", email: "ada@example.com" })
      await recordAuditEvent(tx, events, "member.invite", {
        data: { email: "not-an-email" },
      })
    }),
    /invalid payload for audit event "member.invite"/,
  )

  assert.equal((await db.select().from(auditEvents)).length, 0)
  assert.equal((await db.select().from(members)).length, 0)
  assert.equal((await db.select().from(auditLogs)).length, 0)
})

test("unknown event name throws", async () => {
  const { db } = await makeDb()
  await assert.rejects(
    recordAuditEvent(db, events, "member.remove" as "member.invite", {
      data: { email: "ada@example.com" },
    }),
    /unknown audit event "member.remove"/,
  )
  assert.equal((await db.select().from(auditEvents)).length, 0)
})

test("recordEvent writes through the ambient audit context", async () => {
  const { db } = await makeDb()

  await runWithAuditContext(
    { actorId: "user_9", context: { workspace_id: "ws_9" } },
    () =>
      recordEvent(db, events, "api_key.revoke", {
        subject: { type: "api_key", id: "k1" },
        data: { keyId: "k1", reason: "leaked" },
      }, { contextColumns }),
  )

  const [row] = await db.select().from(auditEvents)
  assert.equal(row?.name, "api_key.revoke")
  assert.equal(row?.user_id, "user_9")
  assert.equal((row as Record<string, unknown>).workspace_id, "ws_9")
  assert.deepEqual(row?.data, { keyId: "k1", reason: "leaked" })

  await assert.rejects(
    recordEvent(db, events, "api_key.create", { data: { keyId: "k2" } }),
    /outside an audit context/,
  )
})

test("custom schema and table names line up between install, recorder and drizzle table", async () => {
  const client = new PGlite()
  const db = drizzle({ client })
  await client.exec(createAuditEventsInstallSql({ auditSchema: "audit", eventsTable: "events" }))
  const table = pgAuditEventsTable({ schema: "audit", name: "events" })

  await withAuditedTransaction(db, "user_1", (tx) =>
    recordAuditEvent(tx, events, "api_key.create", { data: { keyId: "k1" } }, {
      auditSchema: "audit",
      eventsTable: "events",
    }),
  )

  const rows = await listAuditEvents(db, table)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.userId, "user_1")
  assert.deepEqual(rows[0]?.context, {})
})

async function seed() {
  const { client, db } = await makeDb()
  const record = (
    actor: string,
    workspace: string,
    write: (tx: Parameters<Parameters<typeof withAuditedTransaction>[2]>[0]) => Promise<void>,
  ) => withAuditedTransaction(db, actor, write, { context: { workspace_id: workspace } })
  const opts = { contextColumns }

  await record("user_1", "ws_1", (tx) =>
    recordAuditEvent(tx, events, "member.invite", { subject: { type: "workspace", id: "ws_1" }, data: { email: "a@example.com" } }, opts))
  await record("user_1", "ws_1", (tx) =>
    recordAuditEvent(tx, events, "api_key.create", { subject: { type: "api_key", id: "k1" }, data: { keyId: "k1" } }, opts))
  await record("user_2", "ws_2", (tx) =>
    recordAuditEvent(tx, events, "api_key.revoke", { subject: { type: "api_key", id: "k1" }, data: { keyId: "k1" } }, opts))
  await record("user_2", "ws_2", (tx) =>
    recordAuditEvent(tx, events, "api1key.create", { subject: { type: "api_key", id: "k2" }, data: { keyId: "k2" } }, opts))
  await record("user_1", "ws_2", (tx) =>
    recordAuditEvent(tx, events, "member.invite", { subject: { type: "workspace", id: "ws_2" }, data: { email: "b@example.com", role: "admin" } }, opts))

  return { client, db }
}

const ids = (rows: { id: number }[]) => rows.map((r) => r.id)

test("listAuditEvents returns rows newest first with the public shape", async () => {
  const { db } = await seed()
  const rows = await listAuditEvents(db, auditEvents)
  assert.deepEqual(ids(rows), [5, 4, 3, 2, 1])
  assert.deepEqual(rows[0], {
    id: 5,
    name: "member.invite",
    subjectType: "workspace",
    subjectId: "ws_2",
    userId: "user_1",
    data: { email: "b@example.com", role: "admin" },
    createdAt: rows[0]?.createdAt,
    context: { workspace_id: "ws_2" },
  })
  assert.ok(rows[0]?.createdAt instanceof Date)
})

test("listAuditEvents filters by exact name, family and lists of both", async () => {
  const { db } = await seed()
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: "member.invite" })), [5, 1])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: "api_key.*" })), [3, 2])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: ["api_key.create", "api1key.*"] })), [4, 2])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: [] })), [])
})

test("listAuditEvents escapes LIKE wildcards in a family prefix", async () => {
  const { db } = await seed()
  // "_" must not match the "1" in api1key, "%" must not match anything.
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: "api_key.*" })), [3, 2])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: "api%.*" })), [])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: "%.*" })), [])
})

test("listAuditEvents filters by subject, actor and context", async () => {
  const { db } = await seed()
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { subject: { type: "api_key" } })), [4, 3, 2])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { subject: { type: "api_key", id: "k1" } })), [3, 2])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { userId: "user_2" })), [4, 3])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { context: { workspace_id: "ws_2" } })), [5, 4, 3])
  assert.deepEqual(
    ids(await listAuditEvents(db, auditEvents, { userId: "user_1", context: { workspace_id: "ws_2" } })),
    [5],
  )
  await assert.rejects(
    listAuditEvents(db, auditEvents, { context: { tenant_id: "t" } }),
    /unknown audit context column "tenant_id"/,
  )
})

test("listAuditEvents filters by time window", async () => {
  const { client, db } = await seed()
  await client.exec(`
    UPDATE audit_events SET created_at = ('2026-01-0' || id || 'T00:00:00Z')::timestamptz;
  `)
  const window = await listAuditEvents(db, auditEvents, {
    after: new Date("2026-01-02T00:00:00Z"),
    before: new Date("2026-01-05T00:00:00Z"),
  })
  assert.deepEqual(ids(window), [4, 3])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { after: new Date("2026-01-04T12:00:00Z") })), [5])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { before: new Date("2026-01-02T00:00:00Z") })), [1])
})

test("listAuditEvents paginates with cursor and limit", async () => {
  const { db } = await seed()
  const page1 = await listAuditEvents(db, auditEvents, { limit: 2 })
  assert.deepEqual(ids(page1), [5, 4])
  const page2 = await listAuditEvents(db, auditEvents, { limit: 2, cursor: page1.at(-1)!.id })
  assert.deepEqual(ids(page2), [3, 2])
  const page3 = await listAuditEvents(db, auditEvents, { limit: 2, cursor: page2.at(-1)!.id })
  assert.deepEqual(ids(page3), [1])
  assert.deepEqual(ids(await listAuditEvents(db, auditEvents, { name: "member.invite", cursor: 5 })), [1])
  await assert.rejects(listAuditEvents(db, auditEvents, { limit: 0 }), /limit must be a positive integer/)
})

test("createAuditEventsInstallSql is idempotent and indexes context columns", async () => {
  const client = new PGlite()
  const sql = createAuditEventsInstallSql({
    contextColumns: [{ column: "workspace_id" }, { column: "client_id", index: false }],
  })
  await client.exec(sql)
  await client.exec(sql)
  const { rows } = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'audit_events' ORDER BY indexname`,
  )
  assert.deepEqual(
    rows.map((r) => r.indexname),
    [
      "audit_events_created_at_idx",
      "audit_events_name_idx",
      "audit_events_pkey",
      "audit_events_subject_idx",
      "audit_events_user_id_idx",
      "audit_events_workspace_id_idx",
    ],
  )
})

test("audit_events and audit_logs stay separate", async () => {
  const { db } = await makeDb()
  await withAuditedTransaction(db, "user_1", async (tx) => {
    await tx.insert(members).values({ id: "m1", email: "ada@example.com" })
  })
  assert.equal((await db.select().from(auditEvents)).length, 0)
  const logs = await db.select().from(auditLogs).orderBy(asc(auditLogs.id))
  assert.equal(logs.length, 1)
})
