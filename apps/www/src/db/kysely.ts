import { Pool as PoolServerless } from "@neondatabase/serverless"
import { Generated, Kysely, PostgresDialect } from "kysely"
import { AuthDb } from "./KyselyAuthInterface"

// TODO: maybe zod interfaces + { generated }?
interface Session {
  id: string
  created_at: Generated<string>
  browser?: string
  os?: string
  language?: string
  country?: string
  device?: string
  referrer?: string
}

interface Pageview {
  id: Generated<number>
  session_id: string
  created_at: Generated<string>
  url: string
  origin: string | null
  raw: string | null
}

interface Event {
  id: Generated<number>
  session_id: string
  created_at: Generated<string>
  url: string
  type: string
  origin: string | null
  raw: string | null
}

interface EventData {
  id: Generated<number>
  event_id: number
  event_data: string
}

interface Redirects {
  id: string
  status: string
  url: string
  created_at: string
  password_hash?: string
}

type LuchyDb = {
  sessions: Session
  pageviews: Pageview
  events: Event
  event_data: EventData
}

type Db = {
  redirects: Redirects
} & LuchyDb &
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

export const getLuchyDb = () => getDb<LuchyDb>()
