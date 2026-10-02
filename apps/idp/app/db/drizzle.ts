import { defineRelations } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"

/**
 * Relational-query (RQB v2) config: every table, plus the Better Auth relations
 * generated into auth-schema.ts (the drizzle adapter's joins read them).
 */
export const relations = { ...defineRelations(schema), ...schema.authRelations }

export const createDrizzleClient = (db: D1Database) => {
  return drizzle(db, { relations })
}

export type DrizzleClient = ReturnType<typeof createDrizzleClient>
