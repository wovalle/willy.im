import type { AuditContextColumn } from "./types.js"

export const DEFAULT_AUDIT_SCHEMA = "public"
export const DEFAULT_AUDIT_TABLE = "audit_logs"
export const DEFAULT_EVENTS_TABLE = "audit_events"
export const DEFAULT_CONTEXT_KEY = "app.user_id"
export const DEFAULT_TRIGGER_FUNCTION = "drizzle_audit_trigger"
export const DEFAULT_ROW_ID_COLUMN = "id"

export function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

export function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

export function qualifyName(name: string, schema?: string) {
  if (!schema) {
    return quoteIdent(name)
  }

  return `${quoteIdent(schema)}.${quoteIdent(name)}`
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
 * column name and applying defaults for `sessionKey` / `index`.
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
      sessionKey: entry.sessionKey?.trim() || `app.${column}`,
      index: entry.index ?? true,
    })
  }

  return resolved
}
