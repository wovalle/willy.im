import { Kysely, sql } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("sessions")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("browser", "varchar(20)")
    .addColumn("os", "varchar(20)")
    .addColumn("language", "varchar(35)")
    .addColumn("country", "varchar(10)")
    .addColumn("device", "varchar(20)")
    .addColumn("referrer", "varchar(500)")
    .execute()

  await db.schema
    .createTable("pageviews")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("session_id", "uuid", (col) => col.notNull().references("sessions.id"))
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("url", "varchar(500)", (col) => col.notNull()) // TODO: revisit
    .addColumn("origin", "varchar(30)")
    .addColumn("raw", "jsonb")
    .execute()

  await db.schema
    .createTable("events")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("session_id", "uuid", (col) => col.notNull().references("sessions.id"))
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("url", "varchar(500)", (col) => col.notNull())
    .addColumn("type", "varchar(50)", (col) => col.notNull())
    .addColumn("origin", "varchar(30)")
    .addColumn("raw", "jsonb")
    .execute()

  // TODO: maybe include in the events table?
  await db.schema
    .createTable("event_data")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("event_id", "integer", (col) => col.notNull().unique().references("events.id"))
    .addColumn("event_data", "jsonb", (col) => col.notNull())
    .execute()

  // created_at indexes
  await db.schema.createIndex("session_created_at").on("sessions").column("created_at").execute()
  await db.schema.createIndex("event_created_at").on("events").column("created_at").execute()
  await db.schema.createIndex("pageview_created_at").on("pageviews").column("created_at").execute()

  // session indexes
  await db.schema.createIndex("pageview_session").on("pageviews").column("session_id").execute()
  await db.schema.createIndex("event_session").on("events").column("session_id").execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("event_data").execute()
  await db.schema.dropTable("events").execute()
  await db.schema.dropTable("pageviews").execute()
  await db.schema.dropTable("sessions").execute()
}
