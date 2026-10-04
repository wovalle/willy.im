import { beforeEach, describe, expect, test, vi } from "vitest"
import { z } from "zod"
import {
  createApp,
  declareService,
  definePolicies,
  fail,
  method,
  registry,
  safe,
  tools,
  type Grant,
} from "../src/index.js"
import { toSchema } from "../src/method.js"
import { META } from "../src/types.js"
import {
  anonymous,
  app,
  auth,
  context,
  ctxFor,
  events,
  key,
  member,
  reset,
  rows,
  status,
  superadmin,
} from "./fixture.js"

beforeEach(() => {
  reset()
  events.length = 0
})

const post = (path: string, body?: unknown) =>
  new Request(`https://x.test${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe("a call", () => {
  test("a method whose `when` is false doesn't exist: the unknown-method 404, before the permission, and no onCall", async () => {
    const ctx = await ctxFor([]) // no thread, no grants
    const err = await ctx.services.notes.reply({ text: 1 as never }).catch((e: any) => e)
    expect(err.status).toBe(404)
    expect(await err.json()).toEqual({ error: "no method notes.reply; see /openapi.json" })
    expect(events).toEqual([])
  })

  test("a `when` that throws hides the method", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const shaky = createApp({
      auth,
      context,
      services: {
        x: declareService(() => ({
          y: method(
            {
              summary: "y",
              permission: "notes:read",
              when: () => {
                throw new Error("boom")
              },
            },
            async () => {},
          ),
        })),
      },
    })
    const ctx = await shaky.context(member("w1", ["notes:read"]), "w1")
    expect(await status((ctx.services as any).x.y())).toBe(404)
    spy.mockRestore()
  })

  test("errors on the input as a whole are reported under `_`", async () => {
    const strict = createApp({
      auth,
      context,
      services: {
        x: declareService(() => ({
          y: method(
            {
              summary: "y",
              permission: "notes:read",
              input: z
                .object({ a: z.number(), b: z.number() })
                .refine((v) => v.a < v.b, "a must be below b"),
            },
            async () => {},
          ),
        })),
      },
    })
    const ctx = await strict.context(member("w1", ["notes:read"]), "w1")
    const err = await (ctx.services as any).x.y({ a: 2, b: 1 }).catch((e: any) => e)
    expect((await err.json()).fields).toEqual({ _: ["a must be below b"] })
  })

  test("onCall is awaited before the call returns", async () => {
    const seen: string[] = []
    const slow = createApp({
      auth,
      context,
      services: app.config.services,
      onCall: async (e) => {
        await new Promise((r) => setTimeout(r, 5))
        seen.push(e.method)
      },
    })
    const ctx = await slow.context(member("w1", ["notes:read"]), "w1")
    await ctx.services.notes.get({ id: "1" })
    expect(seen).toEqual(["get"])
  })

  test("the permission is checked before the input", async () => {
    const ctx = await ctxFor([], "t1")
    expect(await status(ctx.services.notes.reply({ text: 1 as never }))).toBe(403)
  })

  test("invalid input is a 400 with field errors; input takes a plain shape or any zod schema", async () => {
    const ctx = await ctxFor(["notes:*"])
    const err = await ctx.services.notes.get({ id: 1 as never }).catch((e: any) => e)
    expect(err.status).toBe(400)
    expect(await err.json()).toEqual({
      error: "invalid input",
      fields: { id: [expect.any(String)] },
    })
    // a schema is parsed as is: z.coerce turns "5" into 5
    expect(await status(ctx.services.notes.create({ title: "x", pages: "5" }))).toBe(200)
    expect(await status(ctx.services.notes.create({ title: "x", pages: "0" }))).toBe(400)
  })

  test("internal callers get the method's value as is: the output isn't checked or stripped", async () => {
    const ctx = await ctxFor(["notes:read"])
    expect(await ctx.services.notes.get({ id: "1" })).toHaveProperty("secret", "s")
    expect(await ctx.services.notes.broken()).toEqual({ id: "1", title: 7 })
  })

  test("onCall fires once per call with the parsed input and the outcome", async () => {
    const ctx = await ctxFor(["notes:read"])
    await ctx.services.notes.create({ title: "x", pages: "2" }).catch(() => {})
    await ctx.services.notes.get({ id: "1" })
    await ctx.services.notes.broken()
    await app.handle(post("/api/notes.broken"), ctx).catch(() => {})
    expect(
      events.map(({ service, method, ok, input }) => ({ service, method, ok, input })),
    ).toEqual([
      { service: "notes", method: "create", ok: false, input: { title: "x", pages: "2" } },
      { service: "notes", method: "get", ok: true, input: { id: "1" } },
      { service: "notes", method: "broken", ok: true, input: undefined },
      { service: "notes", method: "broken", ok: false, input: undefined },
    ])
    expect((events[0].error as Response).status).toBe(403)
    expect(events[1].ctx).toBe(ctx)
    expect(events[1].ms).toBeGreaterThanOrEqual(0)
  })

  test("a throwing onCall doesn't fail the call", async () => {
    const loud = createApp({
      auth,
      context,
      services: app.config.services,
      onCall: () => {
        throw new Error("audit down")
      },
    })
    const ctx = await loud.context(member("w1", ["notes:read"]), "w1")
    expect(await ctx.services.notes.get({ id: "1" })).toMatchObject({ id: "1" })
  })

  test("service-to-service calls are trusted: the caller needs only the method it called", async () => {
    const tagsOnly = await ctxFor(["tags:read"])
    expect(await tagsOnly.services.tags.forNote({ id: "1" })).toEqual({
      tags: ["a"],
      title: "First",
    })
    expect(await status(tagsOnly.services.notes.get({ id: "1" }))).toBe(403)
  })

  test("cron and queues are a system principal holding `*`", async () => {
    const ctx = await app.context({ id: "system:cron", grants: ["*"], memberships: [] }, "w9")
    expect(ctx.caller.isSuperadmin).toBe(true)
    expect(ctx.tenantId).toBe("w9")
    expect(await ctx.services.tags.forNote({ id: "1" })).toEqual({ tags: ["a"], title: "First" })
  })

  test("safe returns field errors from FormData or an object, and rethrows anything else", async () => {
    const ctx = await ctxFor(["notes:*"])
    const form = new FormData()
    form.set("title", "x")
    form.set("pages", "-3")
    const bad = await safe(ctx.services.notes.create, form)
    expect(bad).toEqual({ ok: false, errors: { pages: [expect.any(String)] } })
    form.set("pages", "7")
    expect(await safe(ctx.services.notes.create, form)).toEqual({
      ok: true,
      value: { id: expect.any(String), title: "x" },
    })
    expect(await status(safe(ctx.services.notes.get, { id: "404" }))).toBe(404)
  })

  test("definePolicies merges extra fields into the caller's filter", () => {
    const scope = definePolicies({
      note: (c: { workspaceId: string }) => ({ workspaceId: c.workspaceId }),
      task: (c: { userId: string }) => ({ assignedTo: c.userId }),
    })({ workspaceId: "w1", userId: "u1" })
    expect(scope.note({ id: "n9" })).toEqual({ workspaceId: "w1", id: "n9" })
    expect(scope.task()).toEqual({ assignedTo: "u1" })
  })
})

describe("calls between operations", () => {
  // `tasks` methods (tags:read) each call one `ledger` method another way.
  let seen: unknown
  const nested = createApp({
    auth,
    context,
    services: {
      ledger: declareService((ctx) => ({
        view: () => ctx, // plain: how a test reaches the context factories close over
        write: method(
          {
            summary: "Write an amount.",
            permission: "notes:write",
            input: { amount: z.number() },
            output: z.number(),
          },
          async ({ amount }) => {
            seen = ctx.caller
            return amount
          },
        ),
        purge: method({ summary: "Purge.", permission: "*" }, async () => {}),
        inThread: method(
          {
            summary: "Only in a thread.",
            permission: "notes:read",
            when: (c) => c.thread !== null,
          },
          async () => {},
        ),
        guarded: method(
          { summary: "Never reached indirectly.", permission: "notes:read" },
          async () => {
            ctx.caller.require("notes:write")
          },
        ),
      })),
      tasks: declareService((ctx) => ({
        write: method({ summary: "Write.", permission: "tags:read", output: z.number() }, () =>
          (ctx.services as any).ledger.write({ amount: 1 }),
        ),
        writeBad: method({ summary: "Write garbage.", permission: "tags:read" }, async () => {
          await (ctx.services as any).ledger.write({ amount: "x" as never })
        }),
        purge: method({ summary: "Purge.", permission: "tags:read" }, () =>
          (ctx.services as any).ledger.purge(),
        ),
        inThread: method({ summary: "Call a thread method.", permission: "tags:read" }, () =>
          (ctx.services as any).ledger.inThread(),
        ),
        guarded: method({ summary: "Call a guarded method.", permission: "tags:read" }, () =>
          (ctx.services as any).ledger.guarded(),
        ),
      })),
    },
    onCall: (e) => {
      events.push(e)
    },
  }) as any
  const as = (grants: Grant[], thread: string | null = null) =>
    nested.context(member("w1", grants), "w1", { thread })
  /** The context the factories close over: same values, trusted services. */
  const inner = (ctx: any) => ctx.services.ledger.view()

  test("a call that enters the app is checked", async () => {
    const ctx = await as(["tags:read"])
    expect(await status(ctx.services.ledger.write({ amount: 1 }))).toBe(403)
  })

  test("a call one operation makes to another skips the permission", async () => {
    const ctx = await as(["tags:read"])
    expect(await ctx.services.tasks.write()).toBe(1)
  })

  test("a superadmin-only method is trusted the same way", async () => {
    const ctx = await as(["tags:read"])
    expect(await status(ctx.services.ledger.purge())).toBe(403)
    expect(await status(ctx.services.tasks.purge())).toBe(200)
  })

  test("the nested call sees the original caller", async () => {
    const ctx = await as(["tags:read"])
    await ctx.services.tasks.write()
    expect(seen).toBe(ctx.caller)
    expect(inner(ctx).caller).toBe(ctx.caller)
    expect(inner(ctx).scope).toBe(ctx.scope) // row policies scope by the real caller
  })

  test("`when` still applies: a hidden method is a 404 from inside too", async () => {
    expect(await status((await as(["tags:read"])).services.tasks.inThread())).toBe(404)
    expect(await status((await as(["tags:read"], "t1")).services.tasks.inThread())).toBe(200)
  })

  test("input is still validated: invalid input from inside is a 400", async () => {
    const ctx = await as(["tags:read"])
    expect(await status(ctx.services.tasks.writeBad())).toBe(400)
  })

  test("a method that must never be reached indirectly checks ctx.caller itself", async () => {
    expect(await status((await as(["tags:read"])).services.tasks.guarded())).toBe(403)
    expect(await status((await as(["tags:read", "notes:write"])).services.tasks.guarded())).toBe(
      200,
    )
  })

  test("onCall reports nested calls as internal, with the checked context", async () => {
    const ctx = await as(["tags:read"])
    await ctx.services.tasks.write()
    await ctx.services.ledger.write({ amount: 1 }).catch(() => {})
    expect(
      events.map(({ service, method, internal, ok }) => ({ service, method, internal, ok })),
    ).toEqual([
      { service: "ledger", method: "write", internal: true, ok: true },
      { service: "tasks", method: "write", internal: false, ok: true },
      { service: "ledger", method: "write", internal: false, ok: false },
    ])
    for (const e of events) expect(e.ctx).toBe(ctx)
  })

  test("either view may bind a method first; each keeps its own semantics", async () => {
    const trustedFirst = await as(["tags:read"])
    expect(await inner(trustedFirst).services.ledger.write({ amount: 1 })).toBe(1)
    expect(await status(trustedFirst.services.ledger.write({ amount: 1 }))).toBe(403)
    const checkedFirst = await as(["tags:read"])
    expect(await status(checkedFirst.services.ledger.write({ amount: 1 }))).toBe(403)
    expect(await inner(checkedFirst).services.ledger.write({ amount: 1 })).toBe(1)
  })

  test("handle and tools stay checked, even handed the inner context", async () => {
    const ctx = await as(["tags:read"])
    for (const c of [ctx, inner(ctx)]) {
      expect((await nested.handle(post("/api/ledger.write", { amount: 1 }), c))!.status).toBe(403)
      expect(await (await nested.handle(post("/api/tasks.write"), c))!.json()).toBe(1)
      const list = tools(nested, c)
      expect(list.map((t) => t.name)).not.toContain("ledger_write")
      expect(await list.find((t) => t.name === "tasks_write")!.call({})).toMatchObject({ data: 1 })
    }
    expect(events.filter((e) => !e.internal).map((e) => `${e.service}.${e.method}`)).toEqual([
      "ledger.write",
      "tasks.write",
      "tasks.write",
      "ledger.write",
      "tasks.write",
      "tasks.write",
    ])
  })
})

describe("the registry", () => {
  test("names each method service.method over HTTP and service_method as a tool, unless the contract names it", () => {
    const names = registry(app).map((e) => [e.name, e.tool])
    expect(names).toContainEqual(["notes.get", "notes_get"])
    expect(names).toContainEqual(["notes.reply", "thread_reply"])
  })

  test("an invalid or duplicate tool name fails when the registry is built", () => {
    const named = (name: string) =>
      declareService(() => ({
        x: method({ summary: "x", permission: "notes:read", name }, async () => {}),
      }))
    expect(() => createApp({ auth, context, services: { a: named("has space") } })).toThrow(
      'tool name "has space"',
    )
    expect(() =>
      createApp({ auth, context, services: { a: named("same"), b: named("same") } }),
    ).toThrow('a.x and b.x share the tool name "same"')
  })

  test("createApp fails fast, naming the service, on a factory that uses the context while it builds", () => {
    const eager = declareService((ctx) => {
      const db = (ctx as unknown as { db: { notes: unknown } }).db.notes
      return { db }
    })
    expect(() => createApp({ auth, context, services: { eager } })).toThrow('service "eager"')
  })
})

describe("HTTP", () => {
  test("handle leaves other paths to the router and strips output to the contract", async () => {
    const ctx = await ctxFor(["notes:read"])
    expect(await app.handle(new Request("https://x.test/notes/1"), ctx)).toBeNull()
    const res = await app.handle(post("/api/notes.get", { id: "1" }), ctx)
    expect(await res?.json()).toEqual({ id: "1", title: "First" }) // no secret, no workspaceId
  })

  test("an output the contract rejects is an error", async () => {
    const ctx = await ctxFor(["notes:read"])
    await expect(app.handle(post("/api/notes.broken"), ctx)).rejects.toThrow(
      "notes.broken returned a value its output schema rejects",
    )
  })

  test("each method's output is stripped to its own contract, even for a shared object", async () => {
    const shared = { id: "1", title: "t", secret: "s" }
    const two = createApp({
      auth,
      context,
      services: {
        x: declareService(() => ({
          full: method(
            {
              summary: "f",
              permission: "notes:read",
              output: { id: z.string(), secret: z.string() },
            },
            async () => shared,
          ),
          slim: method(
            { summary: "s", permission: "notes:read", output: { id: z.string() } },
            async () => shared,
          ),
        })),
      },
    })
    const ctx = await two.context(member("w1", ["notes:read"]), "w1")
    const [full, slim] = await Promise.all([
      two.handle(post("/api/x.full"), ctx).then((r) => r!.json()),
      two.handle(post("/api/x.slim"), ctx).then((r) => r!.json()),
    ])
    expect(full).toEqual({ id: "1", secret: "s" })
    expect(slim).toEqual({ id: "1" })
  })

  test("fail(422) and fail(502) reach the caller with their status and message", async () => {
    const failing = createApp({
      auth,
      context,
      services: {
        x: declareService(() => ({
          unknown: method({ summary: "u", permission: "notes:read" }, async () =>
            fail(422, "no such scope: x:y"),
          ),
          upstream: method({ summary: "d", permission: "notes:read" }, async () =>
            fail(502, "the list endpoint is down"),
          ),
        })),
      },
    })
    const ctx = await failing.context(member("w1", ["notes:read"]), "w1")
    const unknown = (await failing.handle(post("/api/x.unknown"), ctx))!
    const upstream = (await failing.handle(post("/api/x.upstream"), ctx))!
    expect([unknown.status, await unknown.json()]).toEqual([422, { error: "no such scope: x:y" }])
    expect([upstream.status, await upstream.json()]).toEqual([
      502,
      { error: "the list endpoint is down" },
    ])
  })

  test("a denied caller gets 403 whatever the body", async () => {
    const ctx = await ctxFor([])
    const res = await app.handle(
      new Request("https://x.test/api/notes.get", { method: "POST", body: "{bad" }),
      ctx,
    )
    expect(res?.status).toBe(403)
    expect(events.map((e) => [e.method, e.ok])).toEqual([["get", false]])
  })

  test("a plain z.date() input isn't advertised as a string; z.coerce.date() is", async () => {
    const dated = createApp({
      auth,
      context,
      services: {
        x: declareService(() => ({
          y: method(
            {
              summary: "y",
              permission: "notes:read",
              input: { plain: z.date(), coerced: z.coerce.date() },
            },
            async () => {},
          ),
        })),
      },
    })
    const ctx = await dated.context(member("w1", ["notes:read"]), "w1")
    const doc = await (await dated.handle(new Request("https://x.test/openapi.json"), ctx))!.json()
    const props =
      doc.paths["/api/x.y"].post.requestBody.content["application/json"].schema.properties
    expect(props.plain).not.toHaveProperty("type", "string")
    expect(props.coerced).toEqual({ type: "string", format: "date-time" })
  })

  test("a method hidden by `when` answers like a missing one, whatever the verb", async () => {
    const ctx = await ctxFor(["notes:*"])
    const hidden = await app.handle(new Request("https://x.test/api/notes.reply"), ctx)
    const missing = await app.handle(new Request("https://x.test/api/notes.nope"), ctx)
    expect(hidden?.status).toBe(404)
    expect(missing?.status).toBe(404)
    const inThread = await ctxFor(["notes:*"], "t1")
    expect(
      await (await app.handle(post("/api/notes.reply", { text: "hi" }), inThread))?.json(),
    ).toEqual({
      thread: "t1",
    })
  })
})

const paths = async (ctx: Parameters<typeof app.handle>[1], a = app) =>
  Object.keys(
    (await (await a.handle(new Request("https://x.test/openapi.json"), ctx))!.json()).paths,
  )

describe("services", () => {
  // Two services that call each other, counting how often each factory runs.
  const pair = () => {
    const built = { a: 0, b: 0 }
    const two = createApp({
      auth,
      context,
      services: {
        a: declareService((ctx) => {
          built.a++
          return {
            view: () => ctx,
            ping: method({ summary: "a", permission: "notes:read", output: z.string() }, () =>
              (ctx.services as any).b.pong(),
            ),
          }
        }),
        b: declareService((ctx) => {
          built.b++
          return {
            pong: method({ summary: "b", permission: "notes:read", output: z.string() }, () =>
              typeof (ctx.services as any).a.ping === "function" ? "pong" : "?",
            ),
          }
        }),
      },
    })
    built.a = built.b = 0 // createApp built both against an empty context for the registry
    const ctx = async () => (await two.context(member("w1", ["notes:read"]), "w1")) as any
    return { two, built, ctx }
  }

  test("a service is built the first time it's read, once per context", async () => {
    const { built, ctx } = pair()
    const one = await ctx()
    expect(built).toEqual({ a: 0, b: 0 })
    expect(one.services.a).toBe(one.services.a)
    expect(built).toEqual({ a: 1, b: 0 })
    ;(await ctx()).services.a
    expect(built).toEqual({ a: 2, b: 0 })
  })

  test("every service is listed before it's built", async () => {
    const { built, ctx } = pair()
    const one = await ctx()
    expect(Object.keys(one.services)).toEqual(["a", "b"])
    const names: string[] = []
    for (const name in one.services) names.push(name)
    expect(names).toEqual(["a", "b"])
    expect(built).toEqual({ a: 0, b: 0 })
  })

  test("the context factories close over has the same services, lazy, sharing one build", async () => {
    const { built, ctx } = pair()
    const one = await ctx()
    const inner = one.services.a.view()
    expect(built).toEqual({ a: 1, b: 0 })
    expect(Object.keys(inner.services)).toEqual(["a", "b"])
    expect(inner.services.a.view).toBe(one.services.a.view) // plain members are shared
    expect(inner.services.a.ping).not.toBe(one.services.a.ping) // methods are bound twice
    expect(inner.services.b).toBe(inner.services.b)
    void one.services.b
    expect(built).toEqual({ a: 1, b: 1 })
    expect(inner.tenantId).toBe(one.tenantId)
  })

  test("services call each other both ways through ctx.services", async () => {
    const { built, ctx } = pair()
    expect(await (await ctx()).services.a.ping()).toBe("pong")
    expect(built).toEqual({ a: 1, b: 1 })
  })

  test("HTTP and tools reach lazily built services", async () => {
    const { two, ctx } = pair()
    expect(await (await two.handle(post("/api/b.pong"), await ctx()))?.json()).toBe("pong")
    const ping = tools(two, await ctx()).find((t) => t.name === "a_ping")!
    expect(await ping.call({})).toEqual({ ok: true, data: "pong", images: [] })
  })

  test("a factory that reads its own service while it builds throws, naming it", async () => {
    let read = false
    const loop = createApp({
      auth,
      context,
      services: {
        self: declareService((ctx) => {
          if (read) void (ctx.services as any).self
          return {}
        }),
      },
    })
    read = true
    const ctx = (await loop.context(member("w1", []), "w1")) as any
    expect(() => ctx.services.self).toThrow('service "self" was read while it builds')
  })
})

describe("binding", () => {
  // Module-level contracts, as a service may share them across its factory runs.
  const shape = { id: z.string() }
  const out = { id: z.string() }
  const lookup = {
    summary: "Look up.",
    permission: "notes:read" as const,
    input: shape,
    output: out,
  }
  const one = createApp({
    auth,
    context,
    services: {
      svc: declareService((ctx) => ({
        view: () => ctx,
        lookup: method(lookup, async ({ id }) => ({ id, extra: 1 })),
        other: method({ summary: "Other.", permission: "notes:read" }, async () => {}),
      })),
    },
  }) as any
  const ctx = async () => (await one.context(member("w1", ["notes:read"]), "w1")) as any
  const both = (c: any) => [c.services.svc, c.services.svc.view().services.svc]

  test("both views enumerate every member, plain functions included, before and after binding", async () => {
    for (const view of both(await ctx())) {
      expect(Object.keys(view)).toEqual(["view", "lookup", "other"])
      const names: string[] = []
      for (const name in view) names.push(name)
      expect(names).toEqual(["view", "lookup", "other"])
      const copy = { ...view }
      expect(Object.keys(copy)).toEqual(["view", "lookup", "other"])
      expect(copy.lookup).toBe(view.lookup)
      expect(Object.values(view).every((m) => typeof m === "function")).toBe(true)
      expect(Object.getOwnPropertyDescriptor(view, "lookup")).toMatchObject({
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  })

  test("a method is bound at most once per view, the first time it's read", async () => {
    const c = await ctx()
    const [checked, trusted] = both(c)
    const first = checked.lookup
    expect(checked.lookup).toBe(first)
    expect({ ...checked }.lookup).toBe(first)
    expect(trusted.lookup).not.toBe(first)
    expect(trusted.lookup).toBe(trusted.lookup)
    expect(Object.create(checked).other).toBe(checked.other)
    checked.other = "replaced"
    expect(checked.other).toBe("replaced")
  })

  test("[META] names the method on the first read and every read after, in both views", async () => {
    const meta = { contract: lookup, service: "svc", method: "lookup" }
    for (const view of both(await ctx())) {
      expect(view.lookup[META]).toEqual(meta)
      expect(view.lookup[META]).toEqual(meta)
      expect(Object.values(view).map((m: any) => m[META]?.method)).toEqual([
        undefined,
        "lookup",
        "other",
      ])
    }
    expect(registry(one).find((e) => e.name === "svc.lookup")).toMatchObject(meta)
  })

  test("a contract's schemas are built once, shared by the registry and every context", async () => {
    const entry = registry(one).find((e) => e.name === "svc.lookup")!
    const [a, b] = [await ctx(), await ctx()]
    const contracts = [entry.contract, ...both(a), ...both(b)].map((v) =>
      "lookup" in v ? v.lookup[META].contract : v,
    )
    for (const c of contracts) {
      expect(toSchema(c.input)).toBe(toSchema(shape))
      expect(toSchema(c.output)).toBe(toSchema(out))
    }
    const tool = (c: any) => tools(one, c).find((t) => t.name === "svc_lookup")!
    expect(tool(a).inputZod).toBe(tool(b).inputZod)
    expect(tool(a).outputZod).toBe(toSchema(out))
    // The shared schemas still check and strip at the edges only.
    expect(await a.services.svc.lookup({ id: "1" })).toEqual({ id: "1", extra: 1 })
    expect(await tool(b).call({ id: "1" })).toEqual({ ok: true, data: { id: "1" }, images: [] })
  })
})

describe("discovery", () => {
  test("lists what the caller may call and what exists in its context", async () => {
    expect(await paths(await ctxFor(["notes:read"]))).toEqual([
      "/api/notes.list",
      "/api/notes.get",
      "/api/notes.snapshot",
      "/api/notes.broken",
    ])
    const writer = await ctxFor(["notes:write"], "t1")
    expect(await paths(writer)).toEqual([
      "/api/notes.create",
      "/api/notes.remove",
      "/api/notes.reply",
    ])
  })

  test("an anonymous caller sees every method by default, and calls reach the method", async () => {
    const ctx = await app.context(anonymous, null)
    expect((await paths(ctx)).length).toBe(7) // all but notes.reply, which needs a thread
    expect((await app.handle(post("/api/notes.get", { id: "1" }), ctx))?.status).toBe(403)
  })
  test("a contract's description is in openapi.json and llms.txt", async () => {
    const ctx = await ctxFor(["notes:write"], "t1")
    const doc = await (await app.handle(new Request("https://x.test/openapi.json"), ctx))!.json()
    expect(doc.paths["/api/notes.reply"].post.description).toBe(
      "Posts the text as a reply. Only exists inside a thread.\n\nRequires the `notes:write` permission.",
    )
    const llms = await (await app.handle(new Request("https://x.test/llms.txt"), ctx))!.text()
    expect(llms).toContain("Reply in the current thread.\n\nPosts the text as a reply.")
  })
})

describe("discovery.anonymous none", () => {
  const closed = createApp({
    ...app.config,
    discovery: {
      anonymous: "none",
      auth: {
        instructions: "Send `Authorization: Bearer <key>`.",
        keysUrl: "https://keys.test/new",
        oauth: { resourceMetadataUrl: "https://x.test/.well-known/oauth-protected-resource" },
      },
    },
  })
  const anon = () => closed.context(anonymous, null)
  const methodNames = registry(app).flatMap((e) => [e.name, e.tool])

  test("llms.txt tells an anonymous caller why it sees no methods and how to authenticate", async () => {
    const res = await closed.handle(new Request("https://x.test/llms.txt"), await anon())
    const text = await res!.text()
    expect(res!.status).toBe(200)
    expect(text).toContain("Methods are listed only for authenticated callers")
    expect(text).toContain("Send `Authorization: Bearer <key>`.")
    expect(text).toContain("https://keys.test/new")
    expect(text).toContain("https://x.test/.well-known/oauth-protected-resource")
    expect(text.split("\n").length).toBeLessThan(15)
    for (const name of methodNames) expect(text).not.toContain(name)
  })

  test("openapi.json has the security schemes and no paths", async () => {
    const res = await closed.handle(new Request("https://x.test/openapi.json"), await anon())
    const doc = await res!.json()
    expect(doc.paths).toEqual({})
    expect(Object.keys(doc.components.securitySchemes)).toEqual(["bearer", "oauth"])
    expect(doc.security).toEqual([{ bearer: [] }, { oauth: [] }])
    expect(doc.info.description).toContain("Methods are listed only for authenticated callers")
    for (const name of methodNames) expect(JSON.stringify(doc)).not.toContain(`"${name}"`)
  })

  test("/api answers 401 with WWW-Authenticate before looking the method up", async () => {
    const ctx = await anon()
    for (const path of ["/api/notes.get", "/api/notes.nope"]) {
      const res = (await closed.handle(post(path, { id: "1" }), ctx))!
      expect(res.status).toBe(401)
      expect(res.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="https://x.test/.well-known/oauth-protected-resource"',
      )
      expect(await res.json()).toEqual({
        error: "authentication required",
        instructions: "Send `Authorization: Bearer <key>`.",
        keysUrl: "https://keys.test/new",
        resourceMetadataUrl: "https://x.test/.well-known/oauth-protected-resource",
      })
    }
  })

  test("openapi declares OAuth as an oauth2 scheme pointing at the resource metadata", async () => {
    const doc = await (await closed.handle(
      new Request("https://x.test/openapi.json"),
      await anon(),
    ))!.json()
    expect(doc.components.securitySchemes.oauth).toMatchObject({
      type: "oauth2",
      "x-resource-metadata": "https://x.test/.well-known/oauth-protected-resource",
    })
  })

  test("the resource metadata URL must be an http(s) URL, and goes out percent-encoded", async () => {
    const withUrl = (url: string) =>
      createApp({
        ...app.config,
        discovery: {
          anonymous: "none",
          auth: { instructions: "i", oauth: { resourceMetadataUrl: url } },
        },
      })
    for (const url of ["not a url", "ftp://x.test/m"])
      expect(() => withUrl(url)).toThrow("resourceMetadataUrl")
    const odd = withUrl('https://bücher.test/m"d')
    const res = (await odd.handle(post("/api/notes.get"), await odd.context(anonymous, null)))!
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://xn--bcher-kva.test/m%22d"',
    )
  })

  test("discovery.docs replaces the wording for credentials and errors", async () => {
    const worded = createApp({
      ...app.config,
      discovery: {
        docs: { key: "tok_…", bearer: "A token.", errors: { conflict: "Already done." } },
      },
    })
    const ctx = await worded.context(member("w1", ["notes:read"]), "w1")
    const doc = await (await worded.handle(new Request("https://x.test/openapi.json"), ctx))!.json()
    expect(doc.components.securitySchemes.bearer.description).toBe("A token.")
    expect(doc.components.responses.Conflict.description).toBe("Already done.")
    const llms = await (await worded.handle(new Request("https://x.test/llms.txt"), ctx))!.text()
    expect(llms).toContain("Authorization: Bearer tok_…")
  })

  test("an authenticated caller is unaffected", async () => {
    const ctx = await closed.context(member("w1", ["notes:read"]), "w1")
    expect(await paths(ctx, closed)).toContain("/api/notes.get")
  })
})

describe("app.context", () => {
  const caller = async (...args: Parameters<typeof app.context>) =>
    (await app.context(...args)).caller

  test("a member gets membership ∪ global grants in the tenant", async () => {
    const c = await caller(
      {
        id: "user:u1",
        grants: ["tags:read"],
        memberships: [{ tenantId: "w1", grants: ["notes:read"] }],
      },
      "w1",
    )
    expect(c.grants).toEqual(["notes:read", "tags:read"])
    expect(c.has("notes:read") && c.has("tags:read")).toBe(true)
    expect(c.tenantId).toBe("w1")
  })

  test("the null tenant uses only global grants", async () => {
    const c = await caller(
      {
        id: "user:u1",
        grants: ["tags:read"],
        memberships: [{ tenantId: "w1", grants: ["notes:read"] }],
      },
      null,
    )
    expect(c.grants).toEqual(["tags:read"])
    expect(c.has("notes:read")).toBe(false)
  })

  test("a non-member with no global grants is a 404, before the app's builder runs", async () => {
    const builder = vi.fn(context)
    const strict = createApp({ auth, context: builder, services: app.config.services })
    const err = await strict.context(member("w1", ["notes:read"]), "w2").catch((e) => e)
    expect(err).toBeInstanceOf(Response)
    expect(err.status).toBe(404)
    expect(await err.json()).toEqual({ error: "not found" })
    expect(builder).not.toHaveBeenCalled()
  })

  test("a non-member with global grants (staff) is let in with them", async () => {
    const staff = { id: "user:staff", grants: ["notes:read" as const], memberships: [] }
    const c = await caller(staff, "w2")
    expect(c.grants).toEqual(["notes:read"])
    expect((await caller(superadmin(), "w2")).isSuperadmin).toBe(true)
  })

  test('an anonymous caller never 404s and has kind "anonymous" and no grants', async () => {
    const c = await caller(anonymous, "w2")
    expect(c.kind).toBe("anonymous")
    expect(c.principal).toBeNull()
    expect(c.tenantId).toBe("w2")
    expect(c.grants).toEqual([])
  })

  test("duplicate memberships for one tenant are unioned", async () => {
    const c = await caller(
      {
        id: "user:u1",
        grants: [],
        memberships: [
          { tenantId: "w1", grants: ["notes:read"] },
          { tenantId: "w1", grants: ["tags:read", "notes:read"] },
          { tenantId: "w2", grants: ["notes:write"] },
        ],
      },
      "w1",
    )
    expect(c.grants).toEqual(["notes:read", "tags:read"])
  })

  test("grants the catalog doesn't know are dropped", async () => {
    const c = await caller(
      {
        id: "user:u1",
        grants: [],
        memberships: [{ tenantId: "w1", grants: ["nope:read" as never] }],
      },
      "w1",
    )
    expect(c.grants).toEqual([])
  })

  test("ctx carries caller, tenantId and actor = actor.id ?? id; the builder gets them too", async () => {
    const seen = vi.fn()
    const spy = createApp({
      auth,
      context: (kit: Parameters<typeof context>[0]) => {
        seen(kit)
        return context(kit)
      },
      services: app.config.services,
    })
    const ctx = await spy.context(key("w1", ["notes:read"]), "w1")
    expect(ctx.actor).toBe("apikey:k1")
    expect(ctx.tenantId).toBe("w1")
    expect(ctx.caller.principal?.id).toBe("apikey:k1")
    expect(seen.mock.calls[0][0]).toMatchObject({ tenantId: "w1", actor: "apikey:k1" })
    expect(seen.mock.calls[0][0].caller).toBe(ctx.caller)
    const impersonated = await spy.context(
      { ...member("w1", []), actor: { id: "user:admin" } },
      "w1",
    )
    expect(impersonated.actor).toBe("user:admin")
    expect((await spy.context(anonymous, null)).actor).toBeNull()
  })

  test("policies scope by ctx.tenantId", async () => {
    const ctx = await app.context(member("w2", ["notes:write"]), "w2")
    const { id } = await ctx.services.notes.create({ title: "x", pages: 1 })
    expect(rows.get(id)?.workspaceId).toBe("w2")
  })
})

describe("caller.require", () => {
  test("is an AND across its arguments", async () => {
    const { caller } = await ctxFor(["notes:read"])
    expect(() => caller.require("notes:read")).not.toThrow()
    const err = (() => {
      try {
        caller.require("notes:read", "notes:write")
      } catch (e) {
        return e
      }
    })()
    expect((err as Response).status).toBe(403)
  })

  test("with no arguments passes", async () => {
    const { caller } = await ctxFor([])
    expect(() => caller.require()).not.toThrow()
  })

  test("takes wildcards and instances, through covers", async () => {
    const { caller } = await ctxFor(["notes:*", "thread:abc"])
    expect(() => caller.require("notes:*", "notes:write", "thread:abc")).not.toThrow()
    expect(() => caller.require("thread:*")).toThrow()
    expect(() => caller.require("*")).toThrow()
  })

  test("grants held in one tenant don't satisfy it in another tenant's context", async () => {
    const principal = {
      id: "user:u1",
      grants: [],
      memberships: [
        { tenantId: "w1", grants: ["notes:*" as const] },
        { tenantId: "w2", grants: ["notes:read" as const] },
      ],
    }
    // minting a notes:write key for w2 is checked in w2's context
    const w1 = (await app.context(principal, "w1")).caller
    const w2 = (await app.context(principal, "w2")).caller
    expect(() => w1.require("notes:write")).not.toThrow()
    expect(() => w2.require("notes:write")).toThrow()
  })
})

describe('`permission: "*"`', () => {
  const admin = createApp({
    auth,
    context,
    services: {
      ...app.config.services,
      ops: declareService(() => ({
        purge: method({ summary: "Purge everything.", permission: "*" }, async () => {}),
      })),
    },
  })
  const opsTools = async (...args: Parameters<typeof admin.context>) =>
    tools(admin, await admin.context(...args)).filter((t) => t.name === "ops_purge")

  test("a superadmin may call it", async () => {
    const ctx = await admin.context(superadmin(), null)
    expect(await status((ctx.services as any).ops.purge())).toBe(200)
  })

  test("a member holding every permission is denied with a 403", async () => {
    const ctx = await admin.context(member("w1", ["notes:*", "tags:*", "thread:*"]), "w1")
    expect(await status((ctx.services as any).ops.purge())).toBe(403)
  })

  test("it is hidden from discovery and tools for anyone but a superadmin", async () => {
    const everything = await admin.context(member("w1", ["notes:*", "tags:*"]), "w1")
    expect(await paths(everything, admin)).not.toContain("/api/ops.purge")
    expect(await opsTools(member("w1", ["notes:*", "tags:*"]), "w1")).toEqual([])
    const root = await admin.context(superadmin(), null)
    expect(await paths(root, admin)).toContain("/api/ops.purge")
    expect(await opsTools(superadmin(), null)).toHaveLength(1)
    const doc = await (await admin.handle(new Request("https://x.test/openapi.json"), root))!.json()
    expect(doc.paths["/api/ops.purge"].post["x-permission"]).toBe("superadmin")
  })
})
