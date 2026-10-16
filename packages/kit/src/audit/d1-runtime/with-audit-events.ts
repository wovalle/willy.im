import { getTableColumns } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import type { z } from "zod"

import {
  parseAuditEvent,
  type AuditEventCatalog,
  type AuditEventInput,
  type AuditEventName,
  type AuditEventSchemas,
} from "../events.js"
import { AUDIT_EVENT_BASE_COLUMNS } from "../events-filter.js"
import type { AuditContext, DrizzleSQLiteDb } from "./with-audit.js"

export type AuditEventsRecorder<T extends AuditEventSchemas> = {
  /** Validate and record one custom event with this recorder's context. */
  record: <K extends AuditEventName<T>>(
    name: K,
    input: AuditEventInput<z.input<T[K]>>,
  ) => Promise<void>
}

/**
 * Creates a recorder for custom events in the D1 audit_events table. Each
 * payload is validated against the catalog; the actor and context columns
 * come from `context`, like `withAudit`.
 *
 * @example
 * import { defineAuditEvents } from "@willyim/kit/audit/events"
 * import { d1AuditEventsTable } from "@willyim/kit/audit/d1"
 * import { withAuditEvents } from "@willyim/kit/audit/d1-runtime"
 *
 * const events = defineAuditEvents({
 *   "member.invite": z.object({ email: z.email(), role: z.string() }),
 * })
 * const auditEvents = d1AuditEventsTable()
 * const recorder = withAuditEvents(db, auditEvents, events, { userId: session.userId })
 * await recorder.record("member.invite", {
 *   subject: { type: "workspace", id: workspaceId },
 *   data: { email, role: "member" },
 * })
 */
export function withAuditEvents<T extends AuditEventSchemas>(
  db: DrizzleSQLiteDb,
  eventsTable: SQLiteTable,
  catalog: AuditEventCatalog<T>,
  context: AuditContext,
): AuditEventsRecorder<T> {
  const extraColumns = Object.keys(getTableColumns(eventsTable)).filter(
    (k) => !AUDIT_EVENT_BASE_COLUMNS.has(k),
  )
  const contextValues: Record<string, string> = { ...(context.context ?? {}) }

  return {
    async record(name, input) {
      const event = parseAuditEvent(catalog, name, input)
      const extra: Record<string, string> = {}
      for (const column of extraColumns) {
        const value = contextValues[column]
        if (value !== undefined && value !== "") {
          extra[column] = value
        }
      }

      await (db as any)
        .insert(eventsTable)
        .values({
          name: event.name,
          subject_type: event.subjectType,
          subject_id: event.subjectId,
          user_id: context.userId,
          data: event.data == null ? null : JSON.stringify(event.data),
          ...extra,
        })
        .run()
    },
  }
}
