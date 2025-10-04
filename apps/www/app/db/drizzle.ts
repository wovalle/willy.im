import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"

export const createDrizzleClient = (db: D1Database) => {
  return drizzle(db, { schema })
}

export type DrizzleClient = ReturnType<typeof createDrizzleClient>
