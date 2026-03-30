import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const auditLogTable = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  event_type: text("event_type").notNull(),
  entity_type: text("entity_type").notNull(),
  entity_id: text("entity_id"),
  table_name: text("table_name"),
  parent_id: text("parent_id"),
  user_id: text("user_id").notNull(),
  details: text("details"),
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
  is_system_event: integer("is_system_event", { mode: "number" })
    .default(0)
    .notNull(),
  created_at: integer("created_at", { mode: "number" }).notNull(),
})
