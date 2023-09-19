import { Kysely } from "kysely"

import initialMigration from "../../../node_modules/@luchyio/adapter-kysely/dist/migrations/postgres/20230722_Initial_migration"

export async function up(db: Kysely<any>): Promise<void> {
  return initialMigration.up(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  return initialMigration.down(db)
}
