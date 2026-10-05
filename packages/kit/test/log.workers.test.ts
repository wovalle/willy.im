// Runs `@willyim/kit/log` (LogTape included) in workerd, the Workers runtime.
import { build } from "esbuild"
import { Miniflare } from "miniflare"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const worker = `
import { configureLog, getLogger, withLogContext } from ${JSON.stringify(fileURLToPath(new URL("../src/log.ts", import.meta.url)))}
export default {
  async fetch() {
    const lines = []
    configureLog({ app: "edge", write: (l) => lines.push(l) })
    const log = getLogger("req")
    await withLogContext({ request: "q1" }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      log.info("req.done", { token: "t", error: new Error("boom") })
    })
    log.debug("dropped")
    return Response.json(lines.map((l) => JSON.parse(l)))
  },
}`

const run = async (compatibilityFlags: string[]) => {
  const out = await build({
    stdin: { contents: worker, loader: "js", resolveDir: process.cwd() },
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
  })
  const mf = new Miniflare({
    modules: true,
    script: out.outputFiles[0].text,
    compatibilityDate: "2025-09-01",
    compatibilityFlags,
  })
  try {
    return (await (await mf.dispatchFetch("http://worker/")).json()) as Record<string, unknown>[]
  } finally {
    await mf.dispose()
  }
}

test("on Workers: JSON lines by default, redaction, errors, and context with nodejs_compat", async () => {
  const [line, ...rest] = await run(["nodejs_compat"])
  expect(rest).toEqual([])
  expect(line).toMatchObject({
    level: "info",
    app: "edge",
    scope: "req",
    msg: "req.done",
    request: "q1",
    token: "[REDACTED]",
    error: { message: "boom", stack: expect.stringContaining("Error: boom") },
  })
}, 30_000)

test("on Workers without nodejs_compat, logging works and withLogContext just runs", async () => {
  const [line] = await run([])
  expect(line).toMatchObject({ msg: "req.done", token: "[REDACTED]" })
  expect(line).not.toHaveProperty("request")
}, 30_000)
