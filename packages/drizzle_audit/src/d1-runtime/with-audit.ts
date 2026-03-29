import {
  getTableColumns,
  getTableName,
  type SQL,
} from "drizzle-orm"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"

type JsonValue = Record<string, unknown>

export type AuditContext = {
  userId: string
  workspaceId?: string
}

export type AuditLogInsertShape = {
  table_name: string
  operation: string
  row_id: string | null
  user_id: string
  old_data: string | null
  new_data: string | null
  [key: string]: unknown
}

/**
 * Minimal interface for a Drizzle SQLite database/transaction.
 * Works with D1, better-sqlite3, libsql.
 */
export type DrizzleSQLiteDb = {
  insert: (table: any) => any
  update: (table: any) => any
  delete: (table: any) => any
  select: (fields?: any) => any
  transaction: (cb: (tx: any) => any) => any
}

function getPrimaryKeyColumn(table: SQLiteTable): SQLiteColumn | null {
  const cols = getTableColumns(table)
  const pk = Object.values(cols).find(
    (c) => (c as SQLiteColumn).primary,
  )
  return (pk as SQLiteColumn) ?? null
}

function getRowId(row: JsonValue, pk: SQLiteColumn | null): string | null {
  if (!pk) return null
  const val = row[pk.name]
  return val != null ? String(val) : null
}

export type AuditedDb<TDb extends DrizzleSQLiteDb> = {
  /**
   * Insert a row and log an INSERT audit event.
   * Returns the inserted row.
   */
  insert: <T extends SQLiteTable>(
    table: T,
    data: Record<string, unknown>,
  ) => JsonValue

  /**
   * Update rows matching `where` and log an UPDATE audit event for each affected row.
   * Captures old_data (before) and new_data (after).
   * Returns the updated rows.
   */
  update: <T extends SQLiteTable>(
    table: T,
    where: SQL,
    data: Record<string, unknown>,
  ) => JsonValue[]

  /**
   * Delete rows matching `where` and log a DELETE audit event for each affected row.
   * Captures old_data.
   * Returns the deleted rows.
   */
  delete: <T extends SQLiteTable>(
    table: T,
    where: SQL,
  ) => JsonValue[]

  /** Access the underlying db for non-audited operations. */
  db: TDb
}

/**
 * Creates an audited wrapper around a Drizzle SQLite database.
 * Each insert/update/delete is wrapped in a transaction that atomically
 * writes to both the target table and the audit_logs table.
 *
 * @param db - A Drizzle SQLite database instance (D1, better-sqlite3, libsql)
 * @param auditTable - The Drizzle table definition for audit_logs
 * @param context - The audit context (userId, optional workspaceId)
 *
 * @example
 * import { withAudit } from "drizzle-audit/d1-runtime"
 * import { d1AuditLogTable } from "drizzle-audit/d1"
 *
 * const auditLogs = d1AuditLogTable()
 * const audited = withAudit(db, auditLogs, { userId: session.userId })
 *
 * // Audited insert
 * audited.insert(users, { id: "u1", name: "Ada" })
 *
 * // Audited update — captures old + new data
 * audited.update(users, eq(users.id, "u1"), { name: "Ada Lovelace" })
 *
 * // Audited delete — captures deleted data
 * audited.delete(users, eq(users.id, "u1"))
 *
 * // Non-audited access
 * audited.db.select().from(users).all()
 */
export function withAudit<TDb extends DrizzleSQLiteDb>(
  db: TDb,
  auditTable: SQLiteTable,
  context: AuditContext,
): AuditedDb<TDb> {
  const workspaceIdColumn = (() => {
    const cols = getTableColumns(auditTable)
    const known = new Set([
      "id",
      "table_name",
      "operation",
      "row_id",
      "user_id",
      "old_data",
      "new_data",
      "created_at",
    ])
    const extra = Object.keys(cols).find((k) => !known.has(k))
    return extra ?? null
  })()

  function buildAuditRow(
    tableName: string,
    operation: string,
    rowId: string | null,
    oldData: JsonValue | null,
    newData: JsonValue | null,
  ): AuditLogInsertShape {
    return {
      table_name: tableName,
      operation,
      row_id: rowId,
      user_id: context.userId,
      old_data: oldData ? JSON.stringify(oldData) : null,
      new_data: newData ? JSON.stringify(newData) : null,
      ...(workspaceIdColumn && context.workspaceId
        ? { [workspaceIdColumn]: context.workspaceId }
        : {}),
    }
  }

  return {
    db,

    insert(table, data) {
      const tableName = getTableName(table)
      const pk = getPrimaryKeyColumn(table)

      return db.transaction((tx: any) => {
        const [row] = tx.insert(table).values(data).returning().all()
        const rowId = getRowId(row, pk)

        tx.insert(auditTable)
          .values(buildAuditRow(tableName, "INSERT", rowId, null, row))
          .run()

        return row
      })
    },

    update(table, where, data) {
      const tableName = getTableName(table)
      const pk = getPrimaryKeyColumn(table)

      return db.transaction((tx: any) => {
        const oldRows: JsonValue[] = tx
          .select()
          .from(table)
          .where(where)
          .all()

        const newRows: JsonValue[] = tx
          .update(table)
          .set(data)
          .where(where)
          .returning()
          .all()

        for (let i = 0; i < newRows.length; i++) {
          const oldRow = oldRows[i] ?? null
          const newRow = newRows[i]!
          const rowId = getRowId(newRow, pk)

          tx.insert(auditTable)
            .values(
              buildAuditRow(tableName, "UPDATE", rowId, oldRow, newRow),
            )
            .run()
        }

        return newRows
      })
    },

    delete(table, where) {
      const tableName = getTableName(table)
      const pk = getPrimaryKeyColumn(table)

      return db.transaction((tx: any) => {
        const oldRows: JsonValue[] = tx
          .select()
          .from(table)
          .where(where)
          .all()

        tx.delete(table).where(where).run()

        for (const oldRow of oldRows) {
          const rowId = getRowId(oldRow, pk)
          tx.insert(auditTable)
            .values(
              buildAuditRow(tableName, "DELETE", rowId, oldRow, null),
            )
            .run()
        }

        return oldRows
      })
    },
  }
}
