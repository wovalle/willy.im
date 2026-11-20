import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Code that names a column must never reach production before the migration
 * that adds it. On D1 the failure is lopsided: an INSERT naming the missing
 * column throws (an uncaught 1101), while a SELECT of it silently reads the
 * column name back as a string literal (SQLite's double-quoted identifier
 * fallback), so a check gated on it quietly turns off. `npm run deploy` is the
 * path that ships the Worker, so it applies the remote migrations first; they
 * are additive, so the old Worker keeps running against the new schema.
 */
describe("npm run deploy", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const { scripts } = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as {
    scripts: Record<string, string>
  }

  it("applies the remote D1 migrations before it deploys the Worker", () => {
    const steps = scripts.deploy.split("&&").map((s) => s.trim())
    const migrate = steps.indexOf("npm run db:migrate-prod")
    const deploy = steps.findIndex((s) => s.startsWith("wrangler deploy"))
    expect(scripts["db:migrate-prod"]).toBe("wrangler d1 migrations apply --remote db")
    expect(migrate).toBeGreaterThanOrEqual(0)
    expect(migrate).toBeLessThan(deploy)
  })
})
