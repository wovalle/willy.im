import { defineRelations } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"

/** Relational-query (RQB v2) config: every table, no relations between them. */
export const relations = defineRelations(schema)

export const createDrizzleClient = (db: D1Database) => {
  return drizzle(db, { relations })
}

export type DrizzleClient = ReturnType<typeof createDrizzleClient>
