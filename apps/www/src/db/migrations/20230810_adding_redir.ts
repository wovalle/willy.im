import { Kysely, sql } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("redirects")
    .addColumn("id", "varchar(50)", (col) => col.primaryKey())
    .addColumn("status", "varchar(50)", (col) => col.defaultTo("published").notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn("password_hash", "text")
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("redirects").ifExists().execute()
}
