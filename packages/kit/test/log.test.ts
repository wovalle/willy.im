import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { z } from "zod"
import { createApp, declareService, method, tools } from "../src/index.js"
import { configureLog, getLogger, withLogContext, type LogOptions } from "../src/log.js"
import { auth, context, member, services } from "./fixture.js"

// Services the fixture's Register doesn't know about.
type Extra = { boom: { fail(): Promise<void> }; odd: { hidden(): Promise<void> } }

let lines: string[] = []
const setup = (options: LogOptions = {}) =>
  configureLog({ app: "notes", pretty: false, write: (l) => lines.push(l), ...options })
const entries = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>)

beforeEach(() => {
  lines = []
  setup()
})
afterEach(() => vi.unstubAllEnvs())

describe("log lines", () => {
  test("one JSON line per event: ts, level, app, scope, msg, then the fields", () => {
    getLogger("chat").info("turn.done", { thread: "t1", ms: 12, usage: { input: 3 } })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain("\n")
    const [e] = entries()
    expect(Object.keys(e)).toEqual(["ts", "level", "app", "scope", "msg", "thread", "ms", "usage"])
    expect(e).toMatchObject({
      level: "info",
      app: "notes",
      scope: "chat",
      msg: "turn.done",
      thread: "t1",
      ms: 12,
      usage: { input: 3 },
    })
    expect(new Date(e.ts as string).toISOString()).toBe(e.ts)
  })

  test("a dotted scope is a nested category; fields never overwrite the base keys", () => {
    getLogger("chat.turn").warn("x", { level: "boom", msg: "no", app: "other" })
    expect(entries()[0]).toMatchObject({
      level: "warn",
      scope: "chat.turn",
      msg: "x",
      app: "notes",
    })
  })

  test("messages are literal: braces aren't LogTape placeholders", () => {
    getLogger("a").info("got {id} and {}", { id: "1" })
    expect(entries()[0].msg).toBe("got {id} and {}")
  })

  test("the ILogger shape: an Error becomes `error`, plain objects merge, the rest goes to `args`", () => {
    const log = getLogger("legacy")
    log.log("[chat] hello", "world", 3)
    log.error("[chat] failed", new Error("down"), { thread: "t1" })
    const [a, b] = entries()
    expect(a).toMatchObject({ level: "info", msg: "[chat] hello", args: ["world", 3] })
    expect(b).toMatchObject({ level: "error", thread: "t1", error: { message: "down" } })
  })

  test("pretty is one readable line, plus the stack of an error", () => {
    setup({ pretty: true })
    getLogger("chat").info("turn.done", { ms: 5 })
    getLogger("chat").error("turn.failed", new Error("down"))
    expect(lines[0]).not.toContain("\n")
    expect(lines[0]).toMatch(/INFO .*chat.* turn\.done .*ms=5/)
    expect(lines[1].split("\n")[0]).toMatch(/ERROR.*turn\.failed.*error=\{"message":"down"\}/)
    expect(lines[1]).toContain("at ")
  })

  test("LOG_FORMAT picks the format; Workers and production get JSON", () => {
    const write = (l: string) => lines.push(l)
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LOG_FORMAT", "json")
    configureLog({ write })
    getLogger("a").info("x")
    vi.stubEnv("LOG_FORMAT", "")
    vi.stubEnv("NODE_ENV", "production")
    configureLog({ write })
    getLogger("a").info("x")
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["x", "x"])
  })

  test("without `write`, lines go to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    configureLog({ app: "notes", pretty: false })
    getLogger("a").info("x")
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({ msg: "x" })
    spy.mockRestore()
  })
})

describe("levels", () => {
  const all = () => {
    const log = getLogger("a")
    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")
    return entries().map((e) => e.level)
  }

  test("info by default: debug is dropped", () => {
    expect(all()).toEqual(["info", "warn", "error"])
  })

  test("LOG_LEVEL sets the lowest level; the option wins over it", () => {
    vi.stubEnv("LOG_LEVEL", "warn")
    setup()
    expect(all()).toEqual(["warn", "error"])
    lines = []
    setup({ level: "debug" })
    expect(all()).toEqual(["debug", "info", "warn", "error"])
  })

  test("an unknown level is info", () => {
    setup({ level: "loud" })
    expect(all()).toEqual(["info", "warn", "error"])
  })
})

describe("redaction", () => {
  test("secret-looking keys are redacted at any depth; counts are kept", () => {
    getLogger("a").info("req", {
      headers: { Authorization: "Bearer abc", cookie: "s=1", "x-api-key": "k" },
      password: "hunter2",
      clientSecret: "x",
      api_key: "k",
      accessToken: { value: "t" },
      inputTokens: 1200,
      user: "willy",
    })
    expect(entries()[0]).toMatchObject({
      headers: { Authorization: "[REDACTED]", cookie: "[REDACTED]", "x-api-key": "[REDACTED]" },
      password: "[REDACTED]",
      clientSecret: "[REDACTED]",
      api_key: "[REDACTED]",
      accessToken: "[REDACTED]",
      inputTokens: 1200,
      user: "willy",
    })
  })

  test("wat_ tokens and bearer values are redacted inside any string, the message included", () => {
    getLogger("a").error("auth failed for wat_abc123XYZ", {
      note: "sent Bearer eyJhbGc.x-y_z to upstream",
      error: new Error("bad key wat_s3cr3t"),
      list: ["wat_zzz"],
    })
    const line = lines[0]
    expect(line).not.toMatch(/abc123XYZ|eyJhbGc|s3cr3t|zzz/)
    expect(entries()[0]).toMatchObject({
      msg: "auth failed for wat_[REDACTED]",
      note: "sent Bearer [REDACTED] to upstream",
      error: { message: "bad key wat_[REDACTED]" },
      list: ["wat_[REDACTED]"],
    })
  })
})

describe("errors", () => {
  test("serialized as { message, stack, cause }, with the cause chain", () => {
    const root = new TypeError("socket closed")
    const err = Object.assign(new Error("fetch failed", { cause: root }), { code: "E_UP" })
    getLogger("a").error("upstream.failed", { error: err })
    const { error } = entries()[0] as { error: Record<string, unknown> }
    expect(error).toMatchObject({
      message: "fetch failed",
      code: "E_UP",
      cause: { name: "TypeError", message: "socket closed" },
    })
    expect(error.stack).toMatch(/fetch failed\n\s+at /)
    expect(lines[0].split("\n")).toHaveLength(1)
  })

  test("a thrown Response is its status; cycles are cut", () => {
    const a: Record<string, unknown> = { name: "a" }
    a.self = a
    getLogger("a").warn("x", { error: new Response(null, { status: 403 }), a })
    expect(entries()[0]).toMatchObject({
      error: { status: 403 },
      a: { name: "a", self: "[Circular]" },
    })
  })
})

describe("correlation fields", () => {
  test("`with` returns a logger whose lines carry the fields", () => {
    const log = getLogger("chat").with({ thread: "t1" }).with({ session: "s1" })
    log.info("turn.start", { run: "r1" })
    expect(entries()[0]).toMatchObject({ thread: "t1", session: "s1", run: "r1" })
  })

  test("withLogContext carries fields across awaits, and only inside", async () => {
    const log = getLogger("chat")
    await withLogContext({ request: "q1" }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      log.info("inside")
    })
    log.info("outside")
    const [inside, outside] = entries()
    expect(inside).toMatchObject({ msg: "inside", request: "q1" })
    expect(outside).not.toHaveProperty("request")
  })

  test("without context storage, withLogContext just runs the callback", () => {
    setup({ contextStorage: null })
    expect(withLogContext({ request: "q1" }, () => 7)).toBe(7)
    getLogger("a").info("x")
    expect(lines).toHaveLength(1)
    expect(entries()[0]).not.toHaveProperty("request")
  })
})

describe("the default onCall", () => {
  const quiet = createApp({ name: "notes", auth, context, services })
  const calls = () => entries().filter((e) => e.msg === "call")

  test("an app without onCall logs one `call` line per call", async () => {
    const ctx = await quiet.context(member("w1", ["notes:read"]), "w1")
    await ctx.services.notes.get({ id: "1" })
    await ctx.services.notes.create({ title: "x", pages: 1 }).catch(() => {})
    const [ok, denied] = calls()
    expect(ok).toMatchObject({
      level: "info",
      scope: "kit",
      call: "notes.get",
      surface: "direct",
      actor: "user:u1",
      ok: true,
    })
    expect(ok.ms).toEqual(expect.any(Number))
    expect(ok).not.toHaveProperty("error")
    expect(denied).toMatchObject({
      level: "warn",
      call: "notes.create",
      ok: false,
      error: { status: 403 },
    })
  })

  test("a failure is an error line with the error; internal calls are debug", async () => {
    setup({ level: "debug" })
    const boom = declareService(() => ({
      fail: method({ summary: "Fail.", permission: "notes:read" }, async () => {
        throw new Error("db down")
      }),
    }))
    const failing = createApp({ auth, context, services: { boom, ...services } })
    const ctx = await failing.context(member("w1", ["notes:read", "tags:read"]), "w1")
    await (ctx.services as unknown as Extra).boom.fail().catch(() => {})
    await ctx.services.tags.forNote({ id: "1" })
    expect(calls().map(({ level, call, surface }) => ({ level, call, surface }))).toEqual([
      { level: "error", call: "boom.fail", surface: "direct" },
      { level: "debug", call: "notes.get", surface: "internal" },
      { level: "info", call: "tags.forNote", surface: "direct" },
    ])
    expect(calls()[0].error).toMatchObject({ message: "db down", stack: expect.any(String) })
  })

  test("the surface says where a call came from: api, tools", async () => {
    const ctx = await quiet.context(member("w1", ["notes:read"]), "w1")
    await quiet.handle(new Request("http://x/api/notes.list", { method: "POST" }), ctx)
    await tools(quiet, ctx)
      .find((t) => t.name === "notes_list")!
      .call({})
    expect(calls().map((e) => e.surface)).toEqual(["api", "tools"])
  })

  test("an app's own onCall replaces it", async () => {
    const seen: string[] = []
    const own = createApp({ auth, context, services, onCall: (e) => void seen.push(e.surface) })
    const ctx = await own.context(member("w1", ["notes:read"]), "w1")
    await ctx.services.notes.get({ id: "1" })
    expect(calls()).toEqual([])
    expect(seen).toEqual(["direct"])
  })

  test("a throwing `when` and a throwing onCall are logged as kit errors", async () => {
    const odd = declareService(() => ({
      hidden: method(
        {
          summary: "Hidden.",
          permission: "notes:read",
          when: () => {
            throw new Error("bad when")
          },
        },
        async () => {},
      ),
    }))
    const loud = createApp({
      auth,
      context,
      services: { odd, ...services },
      onCall: () => {
        throw new Error("audit down")
      },
    })
    const ctx = await loud.context(member("w1", ["notes:read"]), "w1")
    await ctx.services.notes.get({ id: "1" })
    await (ctx.services as unknown as Extra).odd.hidden().catch(() => {})
    expect(entries().map(({ level, scope, msg }) => ({ level, scope, msg }))).toEqual([
      { level: "error", scope: "kit", msg: "onCall.threw" },
      { level: "error", scope: "kit", msg: "when.threw" },
    ])
    expect(entries()[0]).toMatchObject({ call: "notes.get", error: { message: "audit down" } })
  })

  test("a tool's internal error is logged with its id", async () => {
    const boom = declareService(() => ({
      fail: method(
        { summary: "Fail.", permission: "notes:read", input: { id: z.string() } },
        async () => {
          throw new Error("db down")
        },
      ),
    }))
    const failing = createApp({ auth, context, services: { boom, ...services }, onCall: () => {} })
    const ctx = await failing.context(member("w1", ["notes:read"]), "w1")
    const r = await tools(failing, ctx)
      .find((t) => t.name === "boom_fail")!
      .call({ id: "1" })
    const id = !r.ok && r.message.match(/internal error \((\w+)\)/)?.[1]
    expect(entries()[0]).toMatchObject({
      level: "error",
      msg: "tool.failed",
      tool: "boom.fail",
      id,
      error: { message: "db down" },
    })
  })
})
