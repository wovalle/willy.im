import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import * as schema from "../../app/db/schema"
import { getAppEnv } from "../../app/lib/env"
import type { LogFields, Logger } from "../../app/lib/log"
import type { BaseServiceContext } from "../../app/lib/services"

/**
 * In-memory test harness. D1 is SQLite, so a better-sqlite3 `:memory:` database
 * with the real `drizzle/*.sql` migrations applied gives us the production
 * schema without a Workers runtime — the service functions under test only ever
 * touch `ctx.db`, so they run unmodified against it.
 *
 * The migrations run once per process into a template database; each harness
 * restores that snapshot. Tests still get a private database with no shared
 * state — they just don't each pay for replaying the migration history.
 */

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(here, "../../drizzle")

/** The `drizzle/*.sql` files, in journal order, split into statements. */
function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) =>
      readFileSync(join(MIGRATIONS_DIR, f), "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean),
    )
}

/**
 * The migrated schema as a raw SQLite image, built once per process. Every
 * harness restores from this snapshot instead of replaying the migrations, so
 * the cost of `drizzle/*.sql` is paid once no matter how many tests run.
 */
let snapshot: Buffer | null = null

function schemaSnapshot(): Buffer {
  if (snapshot) return snapshot
  const template = new Database(":memory:")
  for (const statement of migrationStatements()) template.exec(statement)
  snapshot = template.serialize()
  template.close()
  return snapshot
}

export type TestHarness = {
  ctx: BaseServiceContext
  /** Log lines captured instead of printed, so assertions can read them. */
  logs: { level: string; message: string; fields?: Record<string, unknown> }[]
  close: () => void
}

export type TestHarnessOptions = {
  /** Overrides for the env `getAppEnv` reads (ADMIN_EMAILS, ADMIN_API_TOKEN, …). */
  env?: Record<string, string>
}

/**
 * A fresh database + service context per call. Env is stubbed on `process.env`
 * (which is what `getAppEnv` parses) and restored by `close()`.
 */
export function createTestHarness(options: TestHarnessOptions = {}): TestHarness {
  const sqlite = new Database(schemaSnapshot())
  sqlite.pragma("foreign_keys = ON")

  const db = drizzle(sqlite, { schema })

  const env: Record<string, string> = {
    APP_ENV: "development",
    LOG_LEVEL: "error",
    BETTER_AUTH_URL: "http://localhost:5173",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    ADMIN_EMAILS: "super@willy.im",
    ...options.env,
  }
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }

  const logs: { level: string; message: string; fields?: LogFields }[] = []
  const record =
    (level: string) =>
    (message: string, fields?: LogFields) =>
      logs.push({ level, message, fields })
  const logger: Logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    child: () => logger,
  }

  const ctx: BaseServiceContext = {
    // better-sqlite3 and D1 speak the same drizzle SQLite API; the driver-level
    // type difference is irrelevant to the code under test.
    db: db as unknown as BaseServiceContext["db"],
    getAppEnv,
    logger,
  }

  return {
    ctx,
    logs,
    close: () => {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      sqlite.close()
    },
  }
}
