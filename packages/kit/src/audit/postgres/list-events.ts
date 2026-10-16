import { desc, getTableColumns } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"

import type { AuditEventFilter, AuditEventRow } from "../events.js"
import {
  auditEventColumns,
  buildAuditEventsWhere,
  resolveLimit,
  toAuditEventRow,
} from "../events-filter.js"

/** Any Drizzle Postgres database or transaction. */
export type AuditEventsQueryDb = {
  select: () => any
}

/**
 * Lists custom events newest first (`ORDER BY id DESC`). Pass the last row's
 * `id` as `cursor` to get the next page.
 */
export async function listAuditEvents(
  db: AuditEventsQueryDb,
  eventsTable: PgTable,
  filter: AuditEventFilter = {},
): Promise<AuditEventRow[]> {
  const columns = getTableColumns(eventsTable)
  const { base, context } = auditEventColumns(columns)
  const rows: Record<string, unknown>[] = await db
    .select()
    .from(eventsTable)
    .where(buildAuditEventsWhere(columns, context, filter, (date) => date))
    .orderBy(desc(base.id!))
    .limit(resolveLimit(filter.limit))

  return rows.map((row) =>
    toAuditEventRow(row, context, {
      data: (value) => value,
      createdAt: (value) => value as Date,
    }),
  )
}
