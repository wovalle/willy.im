import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
export { account, session, user, verification } from "./auth-schema"

// Simple KV store table
export const kv = sqliteTable("kv", {
  id: text().primaryKey().notNull(),
  value: text({ mode: "json" }).notNull(), // JSON column for SQLite
  expires_at: integer({ mode: "timestamp" }), // Timestamp for expiration
})

export const logs = sqliteTable("logs", {
  id: text().primaryKey().notNull(),
  filename: text(),
  client: text(),
  content_type: text(),
  size: integer().notNull(),
  created_at: integer({ mode: "timestamp" }).notNull(),
})

// LEGACY — notes now live in bender's artifact store (lib/bender.server.ts).
// This table is kept only until scripts/migrate-notes-to-bender.mjs has run
// against prod (it reads these rows and writes `note_redirect:<id>` kv rows);
// drop it in a follow-up migration after that.
export const notes = sqliteTable("notes", {
  id: text().primaryKey().notNull(),
  title: text().notNull(),
  content: text().notNull().default(""),
  created_at: integer({ mode: "timestamp" }).notNull(),
  updated_at: integer({ mode: "timestamp" }).notNull(),
})
