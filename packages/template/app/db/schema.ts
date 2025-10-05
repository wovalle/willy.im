import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
export { account, session, user, verification } from "./auth-schema"

export const kv = sqliteTable("kv", {
  id: text().primaryKey().notNull(),
  value: text({ mode: "json" }).notNull(),
  expires_at: integer({ mode: "timestamp" }),
})
