#!/usr/bin/env node
/**
 * CLI: run drizzle-kit generate, then append audit SQL from the consumer's
 * config to the newly created migration file.
 *
 * Usage: drizzle-audit generate [options]
 * Options:
 *   --config <path>         Path to audit config (TS or JS) exporting createAuditSql/createWebAuditSql
 *   --drizzle-config <path> Path to drizzle config for drizzle-kit (default: drizzle.config.ts)
 *   --migrations-dir <path> Dir for migrations relative to cwd (default: drizzle)
 *   --cwd <path>            Working directory (default: process.cwd())
 */

import { execSync, spawnSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const DEFAULT_DRIZZLE_CONFIG = "drizzle.config.ts"
const DEFAULT_MIGRATIONS_DIR = "drizzle"

function parseArgs(): {
  config: string
  drizzleConfig: string
  migrationsDir: string
  cwd: string
} {
  const args = process.argv.slice(2)
  if (args[0] !== "generate") {
    console.error("Usage: drizzle-audit generate --config <path> [options]")
    process.exit(1)
  }
  let config = ""
  let drizzleConfig = DEFAULT_DRIZZLE_CONFIG
  let migrationsDir = DEFAULT_MIGRATIONS_DIR
  let cwd = process.cwd()
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      config = args[++i]
    } else if (args[i] === "--drizzle-config" && args[i + 1]) {
      drizzleConfig = args[++i]
    } else if (args[i] === "--migrations-dir" && args[i + 1]) {
      migrationsDir = args[++i]
    } else if (args[i] === "--cwd" && args[i + 1]) {
      cwd = args[++i]
    }
  }
  if (!config) {
    console.error("Missing required --config <path>")
    process.exit(1)
  }
  return { config, drizzleConfig, migrationsDir, cwd }
}

function findNewestMigrationDir(migrationsDir: string): string {
  const abs = resolve(migrationsDir)
  const entries = readdirSync(abs, { withFileTypes: true })
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => /^\d+_.+/.test(n))
    .sort()
  const newest = dirs[dirs.length - 1]
  if (!newest) {
    throw new Error(`No migration folders found in ${abs}`)
  }
  return resolve(abs, newest)
}

async function getAuditSql(configPath: string, cwd: string): Promise<string> {
  const resolved = resolve(cwd, configPath)
  const ext = resolved.endsWith(".ts")
    ? ".ts"
    : resolved.endsWith(".mts")
      ? ".mts"
      : ""
  if (ext) {
    try {
      const __dirname = fileURLToPath(new URL(".", import.meta.url))
      const runnerPath = resolve(__dirname, "runner.js")
      const out = execSync(
        `node --experimental-strip-types "${runnerPath}" "${resolved}"`,
        { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      )
      return out.trim()
    } catch (e) {
      const err = e as { message?: string; stderr?: string }
      console.error(
        "Failed to load .ts config. Requires Node >= 22.6.0.",
      )
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
  const { config, drizzleConfig, migrationsDir, cwd } = parseArgs()
  const drizzleConfigPath = resolve(cwd, drizzleConfig)
  const migrationsAbs = resolve(cwd, migrationsDir)

  console.log("Running drizzle-kit generate...")
  const kit = spawnSync(
    "npx",
    ["drizzle-kit", "generate", "--config", drizzleConfigPath],
    {
      cwd,
      stdio: ["pipe", "inherit", "inherit"],
      input: "\n\n",
      encoding: "utf-8",
    },
  )
  if (kit.status !== 0) {
    process.exit(kit.status ?? 1)
  }

  const migrationDir = findNewestMigrationDir(migrationsAbs)
  const migrationFile = resolve(migrationDir, "migration.sql")
  const existing = readFileSync(migrationFile, "utf-8")
  const auditSql = await getAuditSql(config, cwd)
  const separator = "\n\n"
  writeFileSync(migrationFile, existing + separator + "-- drizzle-audit\n\n" + auditSql, "utf-8")
  console.log("Appended audit SQL to", migrationFile)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
