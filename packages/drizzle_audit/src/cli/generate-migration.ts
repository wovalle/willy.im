#!/usr/bin/env node
/**
 * CLI: run drizzle-kit generate, then append audit SQL from the consumer's
 * config to the newly created migration file.
 *
 * The audit SQL is only appended when (a) drizzle-kit actually created a new
 * migration and (b) the generated audit SQL differs from what the last
 * migration shipped (tracked by hash in <migrations-dir>/.drizzle-audit.json).
 * This keeps trigger DDL out of migrations that don't change it.
 *
 * Usage: drizzle-audit generate [options] [-- extra drizzle-kit args]
 * Options:
 *   --config <path>         Path to audit config (TS or JS) exporting createAuditSql/createWebAuditSql
 *   --drizzle-config <path> Path to drizzle config for drizzle-kit (default: drizzle.config.ts)
 *   --migrations-dir <path> Dir for migrations relative to cwd (default: drizzle)
 *   --cwd <path>            Working directory (default: process.cwd())
 *
 * Any argument not listed above (e.g. --name, --custom) is passed through to
 * `drizzle-kit generate` verbatim.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const DEFAULT_DRIZZLE_CONFIG = "drizzle.config.ts"
const DEFAULT_MIGRATIONS_DIR = "drizzle"
const STATE_FILE = ".drizzle-audit.json"
const MARKER = "-- drizzle-audit"

function parseArgs(): {
  config: string
  drizzleConfig: string
  migrationsDir: string
  cwd: string
  passthrough: string[]
} {
  const args = process.argv.slice(2)
  if (args[0] !== "generate") {
    console.error(
      "Usage: drizzle-audit generate --config <path> [options] [-- extra drizzle-kit args]",
    )
    process.exit(1)
  }
  let config = ""
  let drizzleConfig = DEFAULT_DRIZZLE_CONFIG
  let migrationsDir = DEFAULT_MIGRATIONS_DIR
  let cwd = process.cwd()
  const passthrough: string[] = []
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      config = args[++i]
    } else if (args[i] === "--drizzle-config" && args[i + 1]) {
      drizzleConfig = args[++i]
    } else if (args[i] === "--migrations-dir" && args[i + 1]) {
      migrationsDir = args[++i]
    } else if (args[i] === "--cwd" && args[i + 1]) {
      cwd = args[++i]
    } else if (args[i] === "--") {
      passthrough.push(...args.slice(i + 1))
      break
    } else {
      passthrough.push(args[i])
    }
  }
  if (!config) {
    console.error("Missing required --config <path>")
    process.exit(1)
  }
  return { config, drizzleConfig, migrationsDir, cwd, passthrough }
}

function listMigrationDirs(migrationsAbs: string): string[] {
  if (!existsSync(migrationsAbs)) {
    return []
  }
  return readdirSync(migrationsAbs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => /^\d+_.+/.test(n))
    .sort()
}

function readStateHash(statePath: string): string | undefined {
  if (!existsSync(statePath)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as {
      hash?: string
    }
    return typeof parsed.hash === "string" ? parsed.hash : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolves the drizzle-kit binary from the nearest node_modules/.bin, walking
 * up from cwd. Falls back to a bare "drizzle-kit" (PATH lookup) so globally
 * installed setups keep working. Never uses npx: npx skips PATH and silently
 * network-installs when the package isn't in a local node_modules.
 */
function resolveDrizzleKit(cwd: string): string {
  let dir = cwd
  for (;;) {
    const candidate = resolve(dir, "node_modules", ".bin", "drizzle-kit")
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return "drizzle-kit"
    }
    dir = parent
  }
}

async function getAuditSql(configPath: string, cwd: string): Promise<string> {
  const resolved = resolve(cwd, configPath)
  const isTs = /\.[cm]?ts$/.test(resolved)
  if (isTs) {
    try {
      const __dirname = fileURLToPath(new URL(".", import.meta.url))
      const runnerPath = resolve(__dirname, "runner.js")
      const out = execFileSync(
        "node",
        ["--experimental-strip-types", runnerPath, resolved],
        { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      )
      return out.trim()
    } catch (e) {
      const err = e as { message?: string; stderr?: string }
      console.error("Failed to load .ts config. Requires Node >= 22.6.0.")
      console.error(err.stderr ?? err.message)
      process.exit(1)
    }
  }
  const url = pathToFileURL(resolved).href
  const mod = await import(url)
  const fn = mod.createAuditSql ?? mod.createWebAuditSql
  if (typeof fn !== "function") {
    console.error(
      "Config module must export createAuditSql() or createWebAuditSql()",
    )
    process.exit(1)
  }
  return String(fn()).trim()
}

async function main() {
  const { config, drizzleConfig, migrationsDir, cwd, passthrough } = parseArgs()
  const drizzleConfigPath = resolve(cwd, drizzleConfig)
  const migrationsAbs = resolve(cwd, migrationsDir)

  const before = new Set(listMigrationDirs(migrationsAbs))

  console.log("Running drizzle-kit generate...")
  const kit = spawnSync(
    resolveDrizzleKit(cwd),
    ["generate", "--config", drizzleConfigPath, ...passthrough],
    {
      cwd,
      // Fully inherit stdio so drizzle-kit's interactive prompts (e.g.
      // rename vs create column) reach the user's terminal. Piping stdin
      // used to auto-answer prompts with the default option — which for a
      // column rename means drop + create, i.e. data loss.
      stdio: "inherit",
    },
  )
  if (kit.status !== 0) {
    process.exit(kit.status ?? 1)
  }

  const created = listMigrationDirs(migrationsAbs).filter(
    (name) => !before.has(name),
  )

  const auditSql = await getAuditSql(config, cwd)
  const hash = createHash("sha256").update(auditSql).digest("hex").slice(0, 12)
  const statePath = resolve(migrationsAbs, STATE_FILE)
  const previousHash = readStateHash(statePath)

  if (created.length === 0) {
    if (previousHash === hash) {
      console.log("No new migration and audit SQL unchanged. Nothing to do.")
      return
    }
    console.error(
      "Audit SQL changed but drizzle-kit created no migration (no schema diff).",
    )
    console.error(
      "Create an empty migration to carry the audit changes, e.g.:",
    )
    console.error("  drizzle-audit generate --config ... -- --custom --name audit-update")
    process.exit(1)
  }

  if (created.length > 1) {
    // drizzle-kit generate creates at most one migration per run; more than
    // one new folder means something else wrote to the migrations dir.
    console.error(
      `Expected at most one new migration folder, found ${created.length}: ${created.join(", ")}`,
    )
    process.exit(1)
  }

  const migrationFile = resolve(migrationsAbs, created[0], "migration.sql")

  if (previousHash === hash) {
    console.log(
      `Audit SQL unchanged (${hash}); not appending to ${migrationFile}`,
    )
    return
  }

  const existing = readFileSync(migrationFile, "utf-8")
  if (existing.includes(MARKER)) {
    console.log(`Audit SQL already present in ${migrationFile}; not appending.`)
    return
  }
  writeFileSync(
    migrationFile,
    `${existing}\n\n${MARKER} ${hash}\n\n${auditSql}\n`,
    "utf-8",
  )
  writeFileSync(statePath, `${JSON.stringify({ hash }, null, 2)}\n`, "utf-8")
  console.log("Appended audit SQL to", migrationFile)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
