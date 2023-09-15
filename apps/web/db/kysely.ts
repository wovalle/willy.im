import { Pool as PoolServerless } from "@neondatabase/serverless"
import { Generated, Kysely, PostgresDialect } from "kysely"
import { Pool as PoolPg } from "pg"
import { AuthDb } from "../src/pages/api/auth/KyselyAuthInterface"

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

type Db = {
  sessions: Session
  pageviews: Pageview
  events: Event
  event_data: EventData
  redirects: Redirects
}

const Pool = typeof window === "undefined" ? PoolPg : PoolServerless

export const db = new Kysely<Db>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.NEON_CONNECTION_STRING,
    }),
  }),
})

export const authDb = new Kysely<AuthDb>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.NEON_CONNECTION_STRING,
    }),
  }),
})

export const getDb = () => {
  const Pool = typeof window === "undefined" ? PoolPg : PoolServerless

  return new Kysely<Db>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.NEON_CONNECTION_STRING,
      }),
    }),
  })
}
