/**
 * @willyim/idp/drizzle — the one table a consumer app owns.
 *
 * Import the table into your schema, run `drizzle-kit generate`, and hand the
 * pair to `createIdp({ sessions: drizzleSessions(db, schema.idpSession) })`.
 * That is the whole migration story: one table, no user table, no account
 * table, no verification table.
 *
 * `drizzle-orm` is an optional peer dependency of this subpath only — core
 * never imports it.
 */

import { eq } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { jsonb, pgTable, text as pgText, timestamp } from "drizzle-orm/pg-core"

import type { Actor, Workspace } from "../claims.js"
import type { SessionRecord, SessionStore } from "../store.js"

export const IDP_SESSION_TABLE = "idp_session"

/**
 * SQLite / Cloudflare D1. Timestamps are epoch-millisecond integers and the
 * claim columns are JSON text — both are what drizzle's own modes produce, so
 * `drizzle-kit generate` needs no help.
 */
export function idpSessionSqliteTable(name: string = IDP_SESSION_TABLE) {
  return sqliteTable(name, {
    id: text("id").primaryKey(),
    sub: text("sub").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    image: text("image"),
    permissions: text("permissions", { mode: "json" }).$type<string[]>().notNull(),
    workspaces: text("workspaces", { mode: "json" }).$type<Workspace[]>().notNull(),
    actor: text("actor", { mode: "json" }).$type<Actor | null>(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  })
}

/** Postgres. Same columns, `jsonb` + `timestamptz`. */
export function idpSessionPgTable(name: string = IDP_SESSION_TABLE) {
  return pgTable(name, {
    id: pgText("id").primaryKey(),
    sub: pgText("sub").notNull(),
    email: pgText("email").notNull(),
    name: pgText("name"),
    image: pgText("image"),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    workspaces: jsonb("workspaces").$type<Workspace[]>().notNull(),
    actor: jsonb("actor").$type<Actor | null>(),
    accessToken: pgText("access_token").notNull(),
    refreshToken: pgText("refresh_token"),
    idToken: pgText("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  })
}

/** The SQLite/D1 table under its default name — what most apps import. */
export const idpSession = idpSessionSqliteTable()

/**
 * Structural, not nominal: the store only ever calls four query builders, and
 * typing them loosely is what lets one adapter serve both dialects and both
 * drizzle majors without the package pinning either.
 */
type DrizzleDatabase = {
  select: (...args: any[]) => any
  insert: (...args: any[]) => any
  update: (...args: any[]) => any
  delete: (...args: any[]) => any
}

type IdpSessionTable =
  | ReturnType<typeof idpSessionSqliteTable>
  | ReturnType<typeof idpSessionPgTable>

/** A `SessionStore` backed by drizzle. Works with D1/SQLite and Postgres alike. */
export function drizzleSessions(db: DrizzleDatabase, table: IdpSessionTable): SessionStore {
  const t = table as any

  async function get(id: string): Promise<SessionRecord | null> {
    const rows = await db.select().from(t).where(eq(t.id, id)).limit(1)
    return rows[0] ? toRecord(rows[0]) : null
  }

  return {
    get,
    async create(record) {
      await db.insert(t).values(record)
      return record
    },
    async update(id, patch) {
      const values = Object.fromEntries(
        Object.entries(patch).filter(([key, value]) => key !== "id" && value !== undefined),
      )
      if (Object.keys(values).length > 0) {
        await db.update(t).set(values).where(eq(t.id, id))
      }
      return get(id)
    },
    async delete(id) {
      await db.delete(t).where(eq(t.id, id))
    },
    async deleteBySub(sub) {
      await db.delete(t).where(eq(t.sub, sub))
    },
  }
}

/**
 * Drivers disagree about how faithfully they round-trip a `Date`, so coerce on
 * the way out rather than trusting the dialect.
 */
function toRecord(row: Record<string, unknown>): SessionRecord {
  return {
    ...(row as unknown as SessionRecord),
    permissions: asArray<string>(row.permissions),
    workspaces: asArray<Workspace>(row.workspaces),
    actor: (parseJson(row.actor) as Actor | null) ?? null,
    accessTokenExpiresAt: asDate(row.accessTokenExpiresAt),
    syncedAt: asDate(row.syncedAt) ?? new Date(0),
    expiresAt: asDate(row.expiresAt) ?? new Date(0),
    createdAt: asDate(row.createdAt) ?? new Date(0),
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function asArray<T>(value: unknown): T[] {
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}
