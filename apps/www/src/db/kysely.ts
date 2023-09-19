import { DefaultKyselyDb } from "@luchyio/adapter-kysely"
import { Pool as PoolServerless } from "@neondatabase/serverless"
import { Kysely, PostgresDialect } from "kysely"
import { AuthDb } from "./KyselyAuthInterface"
interface Redirects {
  id: string
  status: string
  url: string
  created_at: string
  password_hash?: string
}

type Db = {
  redirects: Redirects
} & DefaultKyselyDb &
  AuthDb

export const getDb = <GenericDb extends {} = Db>() => {
  return new Kysely<GenericDb>({
    dialect: new PostgresDialect({
      pool: new PoolServerless({
        connectionString: process.env.NEON_CONNECTION_STRING,
      }),
    }),
  })
}

export const getAuthDb = () => getDb<AuthDb>()

export const getLuchyDb = () => getDb<DefaultKyselyDb>()
