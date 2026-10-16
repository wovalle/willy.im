import { z } from "zod"

const EVENT_NAME_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/

export type AuditEventSchemas = Record<string, z.ZodType>

/** A typed set of custom audit events: dotted name → zod schema of its payload. */
export type AuditEventCatalog<T extends AuditEventSchemas> = {
  readonly schemas: T
}

/** Names of the events in a catalog. */
export type AuditEventName<T extends AuditEventSchemas> = keyof T & string

/** What an event is about: a workspace, an api key, a user. */
export type AuditEventSubject = {
  type: string
  id?: string | null
}

export type AuditEventInput<TData> = {
  subject?: AuditEventSubject | null
  data: TData
}

export type ParsedAuditEvent<TName extends string, TData> = {
  name: TName
  subjectType: string | null
  subjectId: string | null
  data: TData
}

/** A row of the audit_events table as returned by the list helpers. */
export type AuditEventRow = {
  id: number
  name: string
  subjectType: string | null
  subjectId: string | null
  userId: string | null
  data: unknown
  createdAt: Date
  /** Context column → value. */
  context: Record<string, string | null>
}

export type AuditEventFilter = {
  /** Exact names, or a family with a trailing ".*" ("api_key.*"). */
  name?: string | string[]
  subject?: { type: string; id?: string }
  userId?: string
  /** Context column → value. */
  context?: Record<string, string>
  /** created_at > after */
  after?: Date
  /** created_at < before */
  before?: Date
  /** Default 50, max 500. */
  limit?: number
  /** id of the last row from the previous page; returns rows with id < cursor. */
  cursor?: number
}

/**
 * Defines the catalog of custom audit events. Names are dotted lowercase
 * segments (`member.invite`, `api_key.revoke`); payloads are validated against
 * their schema when recorded.
 */
export function defineAuditEvents<const T extends AuditEventSchemas>(
  schemas: T,
): AuditEventCatalog<T> {
  for (const name of Object.keys(schemas)) {
    if (!EVENT_NAME_PATTERN.test(name)) {
      throw new Error(
        `invalid audit event name "${name}": use dotted lowercase segments of [a-z0-9_] ("member.invite")`,
      )
    }
  }

  return { schemas }
}

/**
 * Validates `name` against the catalog and `input.data` against its schema.
 * Returns the parsed (zod output) payload. Throws on an unknown name or an
 * invalid payload.
 */
export function parseAuditEvent<
  T extends AuditEventSchemas,
  K extends AuditEventName<T>,
>(
  catalog: AuditEventCatalog<T>,
  name: K,
  input: AuditEventInput<z.input<T[K]>>,
): ParsedAuditEvent<K, z.output<T[K]>> {
  if (!Object.hasOwn(catalog.schemas, name)) {
    throw new Error(`unknown audit event "${name}"`)
  }
  const result = catalog.schemas[name]!.safeParse(input.data)
  if (!result.success) {
    throw new Error(
      `invalid payload for audit event "${name}": ${z.prettifyError(result.error)}`,
      { cause: result.error },
    )
  }
  const subjectType = input.subject?.type.trim() || null
  if (input.subject && !subjectType) {
    throw new Error(`audit event "${name}": subject.type must not be empty`)
  }

  return {
    name,
    subjectType,
    subjectId: input.subject?.id ?? null,
    data: result.data as z.output<T[K]>,
  }
}
