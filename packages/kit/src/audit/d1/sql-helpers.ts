import type { AuditContextColumn } from "./types.js"

export const DEFAULT_AUDIT_TABLE = "audit_logs"
export const DEFAULT_EVENTS_TABLE = "audit_events"
export const DEFAULT_CONTEXT_TABLE = "_audit_context"
export const DEFAULT_ROW_ID_COLUMN = "id"

export function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

export function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

export function assertNonEmpty(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`)
  }
  return value
}

export type ResolvedContextColumn = {
  column: string
  sessionKey: string
  index: boolean
}

/**
 * Normalizes the context columns from the install options, de-duplicating by
 * column name. For D1 the KV key defaults to the column name itself.
 */
export function normalizeContextColumns(
  options: { contextColumns?: AuditContextColumn[] },
): ResolvedContextColumn[] {
  const resolved: ResolvedContextColumn[] = []
  const seen = new Set<string>()
  for (const entry of options.contextColumns ?? []) {
    const column = entry.column?.trim()
    if (!column) {
      throw new Error("contextColumns[].column must not be empty")
    }
    if (seen.has(column)) {
      continue
    }
    seen.add(column)
    resolved.push({
      column,
      sessionKey: entry.sessionKey?.trim() || column,
      index: entry.index ?? true,
    })
  }

  return resolved
}
