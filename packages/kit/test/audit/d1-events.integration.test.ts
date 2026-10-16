import assert from "node:assert/strict"
import { test } from "vitest"
import { z } from "zod"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import {
  createD1AuditEventsInstallSql,
  d1AuditEventsTable,
  listD1AuditEvents,
} from "../../src/audit/d1/index.js"
import { withAuditEvents } from "../../src/audit/d1-runtime/index.js"
import { defineAuditEvents } from "../../src/audit/events.js"

const contextColumns = [{ column: "workspace_id" }] as const
const auditEvents = d1AuditEventsTable({ contextColumns })

const events = defineAuditEvents({
  "member.invite": z.object({ email: z.email(), role: z.enum(["admin", "member"]).default("member") }),
  "api_key.create": z.object({ keyId: z.string() }),
  "api_key.revoke": z.object({ keyId: z.string() }),
  "api1key.create": z.object({ keyId: z.string() }),
})

function makeDb() {
  const sqlite = new Database(":memory:")
  const db = drizzle({ client: sqlite })
  sqlite.exec(createD1AuditEventsInstallSql({ contextColumns: [...contextColumns] }))
  return { db, sqlite }
}

test("withAuditEvents stores actor, context, subject and parsed data", async () => {
  const { db } = makeDb()
  const recorder = withAuditEvents(db, auditEvents, events, {
    userId: "user_1",
    context: { workspace_id: "ws_1", unrelated: "x" },
  })

  await recorder.record("member.invite", {
    subject: { type: "workspace", id: "ws_1" },
    data: { email: "ada@example.com" },
  })

  const rows = db.select().from(auditEvents).all()
  assert.equal(rows.length, 1)
  const row = rows[0]!
  assert.equal(row.name, "member.invite")
  assert.equal(row.subject_type, "workspace")
  assert.equal(row.subject_id, "ws_1")
  assert.equal(row.user_id, "user_1")
  assert.equal(row.workspace_id, "ws_1")
  assert.deepEqual(JSON.parse(row.data!), { email: "ada@example.com", role: "member" })
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
})

test("withAuditEvents rejects invalid payloads and unknown names without writing", async () => {
  const { db } = makeDb()
  const recorder = withAuditEvents(db, auditEvents, events, { userId: null })

  await assert.rejects(
    recorder.record("member.invite", { data: { email: "nope" } }),
    /invalid payload for audit event "member.invite"/,
  )
  await assert.rejects(
    recorder.record("member.remove" as "member.invite", { data: { email: "ada@example.com" } }),
    /unknown audit event "member.remove"/,
  )
  assert.equal(db.select().from(auditEvents).all().length, 0)
})

test("withAuditEvents with no actor or context stores NULLs", async () => {
  const { db } = makeDb()
  await withAuditEvents(db, auditEvents, events, { userId: null }).record("api_key.create", {
    data: { keyId: "k1" },
  })
  const [row] = db.select().from(auditEvents).all()
  assert.equal(row?.user_id, null)
  assert.equal(row?.workspace_id, null)
  assert.equal(row?.subject_type, null)
})

async function seed() {
  const { db, sqlite } = makeDb()
  const as = (userId: string, workspace: string) =>
    withAuditEvents(db, auditEvents, events, { userId, context: { workspace_id: workspace } })

  await as("user_1", "ws_1").record("member.invite", { subject: { type: "workspace", id: "ws_1" }, data: { email: "a@example.com" } })
  await as("user_1", "ws_1").record("api_key.create", { subject: { type: "api_key", id: "k1" }, data: { keyId: "k1" } })
  await as("user_2", "ws_2").record("api_key.revoke", { subject: { type: "api_key", id: "k1" }, data: { keyId: "k1" } })
  await as("user_2", "ws_2").record("api1key.create", { subject: { type: "api_key", id: "k2" }, data: { keyId: "k2" } })
  await as("user_1", "ws_2").record("member.invite", { subject: { type: "workspace", id: "ws_2" }, data: { email: "b@example.com", role: "admin" } })

  return { db, sqlite }
}

const ids = (rows: { id: number }[]) => rows.map((r) => r.id)

test("listD1AuditEvents returns rows newest first with parsed data", async () => {
  const { db } = await seed()
  const rows = await listD1AuditEvents(db, auditEvents)
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
  assert.ok(!Number.isNaN(rows[0]!.createdAt.getTime()))
})

test("listD1AuditEvents filters by name, family, subject, actor and context", async () => {
  const { db } = await seed()
  const list = async (filter: Parameters<typeof listD1AuditEvents>[2]) =>
    ids(await listD1AuditEvents(db, auditEvents, filter))

  assert.deepEqual(await list({ name: "member.invite" }), [5, 1])
  assert.deepEqual(await list({ name: "api_key.*" }), [3, 2])
  assert.deepEqual(await list({ name: ["api_key.create", "api1key.*"] }), [4, 2])
  assert.deepEqual(await list({ name: "api%.*" }), [])
  assert.deepEqual(await list({ subject: { type: "api_key" } }), [4, 3, 2])
  assert.deepEqual(await list({ subject: { type: "api_key", id: "k1" } }), [3, 2])
  assert.deepEqual(await list({ userId: "user_2" }), [4, 3])
  assert.deepEqual(await list({ context: { workspace_id: "ws_2" } }), [5, 4, 3])
  await assert.rejects(list({ context: { tenant_id: "t" } }), /unknown audit context column "tenant_id"/)
})

test("listD1AuditEvents filters by time window", async () => {
  const { db, sqlite } = await seed()
  sqlite.exec(`UPDATE audit_events SET created_at = '2026-01-0' || id || ' 00:00:00';`)
  const list = async (filter: Parameters<typeof listD1AuditEvents>[2]) =>
    ids(await listD1AuditEvents(db, auditEvents, filter))

  assert.deepEqual(
    await list({ after: new Date("2026-01-02T00:00:00Z"), before: new Date("2026-01-05T00:00:00Z") }),
    [4, 3],
  )
  assert.deepEqual(await list({ after: new Date("2026-01-04T12:00:00Z") }), [5])
  assert.deepEqual(await list({ before: new Date("2026-01-02T00:00:00Z") }), [1])
  const [row] = await listD1AuditEvents(db, auditEvents, { limit: 1 })
  assert.equal(row?.createdAt.toISOString(), "2026-01-05T00:00:00.000Z")
})

test("listD1AuditEvents paginates with cursor and limit", async () => {
  const { db } = await seed()
  const page1 = await listD1AuditEvents(db, auditEvents, { limit: 2 })
  assert.deepEqual(ids(page1), [5, 4])
  const page2 = await listD1AuditEvents(db, auditEvents, { limit: 2, cursor: page1.at(-1)!.id })
  assert.deepEqual(ids(page2), [3, 2])
  const page3 = await listD1AuditEvents(db, auditEvents, { limit: 2, cursor: page2.at(-1)!.id })
  assert.deepEqual(ids(page3), [1])
})

test("createD1AuditEventsInstallSql is idempotent, honours eventsTable and index: false", () => {
  const sqlite = new Database(":memory:")
  const sql = createD1AuditEventsInstallSql({
    eventsTable: "events",
    contextColumns: [{ column: "workspace_id" }, { column: "client_id", index: false }],
  })
  sqlite.exec(sql)
  sqlite.exec(sql)
  const indexes = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[]
  assert.deepEqual(
    indexes.map((i) => i.name),
    ["events_created_at_idx", "events_name_idx", "events_subject_idx", "events_user_id_idx", "events_workspace_id_idx"],
  )
})
