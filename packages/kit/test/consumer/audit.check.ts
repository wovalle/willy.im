// Compile-time only: the audit tables, imported by name, work as drizzle tables in an app.
// The declarations name drizzle's builder types, so the app's drizzle builds the table type.
import { and, desc, eq, gte, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres"
import { drizzle as sqliteProxy } from "drizzle-orm/sqlite-proxy"
import { d1AuditContextTable, d1AuditEventsTable, d1AuditLogTable } from "@willyim/kit/audit/d1"
import { pgAuditEventsTable, pgAuditLogTable } from "@willyim/kit/audit/postgres"

const auditLogs = pgAuditLogTable({ contextColumns: [{ column: "workspace_id" }] })
const auditEvents = pgAuditEventsTable({ name: "events", schema: "audit" })
const db = drizzle({ connection: "postgres://x" })

export async function postgres() {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.table_name, "x"), inArray(auditLogs.user_id, ["u1"])))
    .orderBy(desc(auditLogs.created_at))
  rows[0]!.id satisfies number
  rows[0]!.table_name satisfies string
  rows[0]!.row_id satisfies string | null
  rows[0]!.created_at satisfies Date
  const picked = await db
    .select({ at: auditLogs.created_at })
    .from(auditLogs)
    .where(gte(auditLogs.created_at, new Date()))
  picked[0]!.at satisfies Date
  const events = await db.select().from(auditEvents).where(eq(auditEvents.name, "x"))
  events[0]!.name satisfies string
  events[0]!.data satisfies unknown
}

const d1Logs = d1AuditLogTable({ contextColumns: [{ column: "workspace_id" }] })
const d1Events = d1AuditEventsTable({ contextColumns: [{ column: "workspace_id" }] })
const d1Context = d1AuditContextTable()
declare const sqlite: ReturnType<typeof sqliteProxy>

export async function d1() {
  const rows = await sqlite.select().from(d1Logs).where(eq(d1Logs.workspace_id, "w1"))
  rows[0]!.id satisfies number
  rows[0]!.workspace_id satisfies string | null
  rows[0]!.created_at satisfies string
  const events = await sqlite.select().from(d1Events).where(eq(d1Events.name, "x"))
  events[0]!.workspace_id satisfies string | null
  const context = await sqlite.select().from(d1Context).where(eq(d1Context.key, "user_id"))
  context[0]!.value satisfies string | null
  // @ts-expect-error not a context column of this table
  d1Logs.tenant_id
}
