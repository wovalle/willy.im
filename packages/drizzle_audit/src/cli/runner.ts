/**
 * Runner script used to load a consumer's audit config (TS or JS) and print the
 * generated SQL to stdout. Invoked with: node [--import tsx] runner.js <config-path>
 * Config module must export createAuditSql() or createWebAuditSql().
 */
const configPath = process.argv[2]
if (!configPath) {
  process.stderr.write("Usage: runner.js <config-path>\n")
  process.exit(1)
}

const path = await import("node:path")
const { pathToFileURL } = await import("node:url")
const resolved = path.resolve(process.cwd(), configPath)
const url = pathToFileURL(resolved).href
const mod = await import(url)
const fn = mod.createAuditSql ?? mod.createWebAuditSql
if (typeof fn !== "function") {
  process.stderr.write(
    "Config module must export createAuditSql() or createWebAuditSql()\n",
  )
  process.exit(1)
}
const sql = String(fn())
process.stdout.write(sql)
export {}
