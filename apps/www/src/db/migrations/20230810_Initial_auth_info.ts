import { Kysely, sql } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("auth_user")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "text")
    .addColumn("email", "text", (col) => col.unique().notNull())
    .addColumn("emailVerified", "timestamptz")
    .addColumn("image", "text")
    .execute()

  await db.schema
    .createTable("auth_account")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("userId", "uuid", (col) =>
      col.references("auth_user.id").onDelete("cascade").notNull(),
    )
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("providerAccountId", "text", (col) => col.notNull())
    .addColumn("refresh_token", "text")
    .addColumn("access_token", "text")
    .addColumn("expires_at", "bigint")
    .addColumn("token_type", "text")
    .addColumn("scope", "text")
    .addColumn("id_token", "text")
    .addColumn("session_state", "text")
    .execute()

  await db.schema
    .createTable("auth_session")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("userId", "uuid", (col) =>
      col.references("auth_user.id").onDelete("cascade").notNull(),
    )
    .addColumn("sessionToken", "text", (col) => col.notNull().unique())
    .addColumn("expires", "timestamptz", (col) => col.notNull())
    .execute()

  await db.schema
    .createTable("auth_verification_token")
    .addColumn("identifier", "text", (col) => col.notNull())
    .addColumn("token", "text", (col) => col.notNull().unique())
    .addColumn("expires", "timestamptz", (col) => col.notNull())
    .execute()

  await db.schema.createIndex("Account_userId_index").on("auth_account").column("userId").execute()

  await db.schema.createIndex("Session_userId_index").on("auth_session").column("userId").execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("auth_account").ifExists().execute()
  await db.schema.dropTable("auth_session").ifExists().execute()
  await db.schema.dropTable("auth_user").ifExists().execute()
  await db.schema.dropTable("auth_verification_token").ifExists().execute()
}
