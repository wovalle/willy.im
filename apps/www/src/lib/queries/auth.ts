import { Pool } from "@neondatabase/serverless"
import { required } from "@willyim/common"
import { Kysely, PostgresDialect } from "kysely"
import { AuthDb } from "../../db/KyselyAuthInterface"

export const getMainAccountTokens = async () => {
  const authDb = new Kysely<AuthDb>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.NEON_CONNECTION_STRING,
      }),
    }),
  })

  return await authDb
    .selectFrom("auth_account")
    .select(["access_token", "refresh_token"])
    .where(
      "id",
      "=",
      required(process.env.AUTH_MAIN_ACCOUNT_ID, "AUTH_MAIN_ACCOUNT_ID is required"),
    )
    .executeTakeFirstOrThrow()
}
