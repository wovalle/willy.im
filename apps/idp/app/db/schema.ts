import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

// Better Auth tables (user / session / account / verification / passkey).
// Generated from scripts/auth.gen.ts via `npm run auth:db:generate`.
export * from "./auth-schema"

/**
 * Placeholder app table from Phase 1. Real domain schema (applications,
 * workspaces, memberships) arrives in later phases.
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
