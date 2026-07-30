import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
// Tests run from dist/test, the built CLI sits in dist/src/cli.
const CLI = resolve(__dirname, "../src/cli/generate-migration.js")

const AUDIT_SQL_V1 = "-- audit v1\nCREATE TABLE IF NOT EXISTS audit_logs (id BIGSERIAL);"
const AUDIT_SQL_V2 = "-- audit v2\nCREATE TABLE IF NOT EXISTS audit_logs (id BIGSERIAL);"

type Workspace = {
  cwd: string
  env: NodeJS.ProcessEnv
  argsFile: string
  setAuditSql: (sql: string) => void
  cleanup: () => void
}

/**
 * Builds a temp workspace with a fake `drizzle-kit` on PATH. The fake records
 * its argv and creates the migration folder named by FAKE_KIT_CREATE (or
 * nothing when unset), mimicking drizzle-kit's "No schema changes" path.
 * PATH is built from scratch so the repo's real node_modules/.bin (which npm
 * prepends when tests run via `npm test`) can't shadow the fake.
 */
function makeWorkspace(): Workspace {
  const cwd = mkdtempSync(join(tmpdir(), "drizzle-audit-cli-"))
  const binDir = join(cwd, "fake-bin")
  mkdirSync(binDir)
  mkdirSync(join(cwd, "drizzle"))

  const argsFile = join(cwd, "kit-args.json")
  const fakeKit = join(binDir, "drizzle-kit")
  writeFileSync(
    fakeKit,
    `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)))
const create = process.env.FAKE_KIT_CREATE
if (create) {
  const dir = join(process.cwd(), "drizzle", create)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "migration.sql"), 'CREATE TABLE "t" ("id" integer);')
} else {
  console.log("No schema changes, nothing to migrate")
}
`,
    "utf-8",
  )
  chmodSync(fakeKit, 0o755)

  const configPath = join(cwd, "audit.config.js")
  const setAuditSql = (sql: string) => {
    writeFileSync(
      configPath,
      `export function createAuditSql() { return ${JSON.stringify(sql)} }\n`,
      "utf-8",
    )
  }
  setAuditSql(AUDIT_SQL_V1)

  writeFileSync(join(cwd, "drizzle.config.ts"), "export default {}\n", "utf-8")

  const env: NodeJS.ProcessEnv = {
    PATH: [binDir, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    HOME: process.env.HOME,
  }

  return {
    cwd,
    env,
    argsFile,
    setAuditSql,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

function runCli(
  ws: Workspace,
  opts: { create?: string; extraArgs?: string[] } = {},
) {
  return spawnSync(
    process.execPath,
    [
      CLI,
      "generate",
      "--config",
      "audit.config.js",
      "--drizzle-config",
      "drizzle.config.ts",
      "--migrations-dir",
      "drizzle",
      ...(opts.extraArgs ?? []),
    ],
    {
      cwd: ws.cwd,
      encoding: "utf-8",
      env: {
        ...ws.env,
        ...(opts.create ? { FAKE_KIT_CREATE: opts.create } : {}),
      },
    },
  )
}

function migrationSql(ws: Workspace, folder: string): string {
  return readFileSync(join(ws.cwd, "drizzle", folder, "migration.sql"), "utf-8")
}

function countMarkers(sql: string): number {
  return sql.split("-- drizzle-audit").length - 1
}

test("appends audit SQL to a newly created migration and writes the state file", () => {
  const ws = makeWorkspace()
  try {
    const result = runCli(ws, { create: "0001_first" })
    assert.equal(result.status, 0, result.stderr)

    const sql = migrationSql(ws, "0001_first")
    assert.match(sql, /CREATE TABLE "t"/)
    assert.equal(countMarkers(sql), 1)
    assert.ok(sql.includes(AUDIT_SQL_V1))

    const statePath = join(ws.cwd, "drizzle", ".drizzle-audit.json")
    assert.ok(existsSync(statePath))
    const state = JSON.parse(readFileSync(statePath, "utf-8"))
    assert.equal(typeof state.hash, "string")
  } finally {
    ws.cleanup()
  }
})

test("does not append to the previous migration when drizzle-kit creates nothing", () => {
  const ws = makeWorkspace()
  try {
    assert.equal(runCli(ws, { create: "0001_first" }).status, 0)

    // Second run: empty schema diff. The old CLI appended the audit block to
    // 0001_first a second time here.
    const result = runCli(ws)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Nothing to do/)
    assert.equal(countMarkers(migrationSql(ws, "0001_first")), 1)
  } finally {
    ws.cleanup()
  }
})

test("skips the append when the audit SQL is unchanged", () => {
  const ws = makeWorkspace()
  try {
    assert.equal(runCli(ws, { create: "0001_first" }).status, 0)

    const result = runCli(ws, { create: "0002_second" })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Audit SQL unchanged/)
    assert.equal(countMarkers(migrationSql(ws, "0002_second")), 0)
  } finally {
    ws.cleanup()
  }
})

test("appends again when the audit SQL changes", () => {
  const ws = makeWorkspace()
  try {
    assert.equal(runCli(ws, { create: "0001_first" }).status, 0)

    ws.setAuditSql(AUDIT_SQL_V2)
    const result = runCli(ws, { create: "0002_second" })
    assert.equal(result.status, 0, result.stderr)

    const sql = migrationSql(ws, "0002_second")
    assert.equal(countMarkers(sql), 1)
    assert.ok(sql.includes(AUDIT_SQL_V2))
  } finally {
    ws.cleanup()
  }
})

test("fails loudly when the audit SQL changes but no migration was created", () => {
  const ws = makeWorkspace()
  try {
    assert.equal(runCli(ws, { create: "0001_first" }).status, 0)

    ws.setAuditSql(AUDIT_SQL_V2)
    const result = runCli(ws)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Audit SQL changed but drizzle-kit created no migration/)
    assert.equal(countMarkers(migrationSql(ws, "0001_first")), 1)
  } finally {
    ws.cleanup()
  }
})

test("passes unknown args through to drizzle-kit", () => {
  const ws = makeWorkspace()
  try {
    const result = runCli(ws, {
      create: "0001_first",
      extraArgs: ["--", "--custom", "--name", "audit-update"],
    })
    assert.equal(result.status, 0, result.stderr)

    const kitArgs = JSON.parse(readFileSync(ws.argsFile, "utf-8"))
    assert.deepEqual(kitArgs.slice(-3), ["--custom", "--name", "audit-update"])
    assert.equal(kitArgs[0], "generate")
  } finally {
    ws.cleanup()
  }
})
