import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
export { account, session, user, verification } from "./auth-schema"

// Simple KV store table
export const kv = sqliteTable("kv", {
  id: text().primaryKey().notNull(),
  value: text({ mode: "json" }).notNull(), // JSON column for SQLite
  expires_at: integer({ mode: "timestamp" }), // Timestamp for expiration
})

export const notes = sqliteTable("notes", {
  id: text().primaryKey().notNull(),
  title: text().notNull(),
  content: text().notNull().default(""),
  created_at: integer({ mode: "timestamp" }).notNull(),
  updated_at: integer({ mode: "timestamp" }).notNull(),
})
