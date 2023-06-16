import { Pool } from "@neondatabase/serverless"
import { Generated, Kysely, PostgresDialect } from "kysely"

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

interface Db {
  sessions: Session
  pageviews: Pageview
  events: Event
  event_data: EventData
}

export const db = new Kysely<Db>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.NEON_CONNECTION_STRING,
    }),
  }),
})
