import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Phase 1 placeholder table — purely to prove the generate → migrate → query
 * pipeline against the IdP's own D1. Real schema (applications, workspaces,
 * memberships, better-auth tables) arrives in later phases.
 */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type AppMeta = typeof appMeta.$inferSelect
export type NewAppMeta = typeof appMeta.$inferInsert
