import { beforeEach, describe, expect, test } from "vitest"
import { createApp, declareService, definePolicies, method, registry, safe } from "../src/index.js"
import { anonymous, app, context, events, reset, status, user } from "./fixture.js"

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
    const ctx = await app.context({ caller: user([]) }) // no thread, no grants
    const err = await ctx.services.notes.reply({ text: 1 as never }).catch((e) => e)
    expect(err.status).toBe(404)
    expect(await err.json()).toEqual({ error: "no method notes.reply; see /openapi.json" })
    expect(events).toEqual([])
  })

  test("the permission is checked before the input", async () => {
    const ctx = await app.context({ caller: user([]), thread: "t1" })
    expect(await status(ctx.services.notes.reply({ text: 1 as never }))).toBe(403)
  })

  test("invalid input is a 400 with field errors; input takes a plain shape or any zod schema", async () => {
    const ctx = await app.context({ caller: user(["notes:*"]) })
    const err = await ctx.services.notes.get({ id: 1 as never }).catch((e) => e)
    expect(err.status).toBe(400)
    expect(await err.json()).toEqual({
      error: "invalid input",
      fields: { id: [expect.any(String)] },
    })
    // a schema is parsed as is: z.coerce turns "5" into 5
    expect(await status(ctx.services.notes.create({ title: "x", pages: "5" }))).toBe(200)
    expect(await status(ctx.services.notes.create({ title: "x", pages: "0" }))).toBe(400)
  })

  test("an output the contract rejects is an error", async () => {
    const ctx = await app.context({ caller: user(["notes:read"]) })
    await expect(ctx.services.notes.broken()).rejects.toThrow(
      "notes.broken returned a value its output schema rejects",
    )
  })

  test("internal callers get the full value", async () => {
    const ctx = await app.context({ caller: user(["notes:read"]) })
    expect(await ctx.services.notes.get({ id: "1" })).toHaveProperty("secret", "s")
  })

  test("onCall fires once per call with the parsed input and the outcome", async () => {
    const ctx = await app.context({ caller: user(["notes:read"]) })
    await ctx.services.notes.create({ title: "x", pages: "2" }).catch(() => {})
    await ctx.services.notes.get({ id: "1" })
    await ctx.services.notes.broken().catch(() => {})
    expect(
      events.map(({ service, method, ok, input }) => ({ service, method, ok, input })),
    ).toEqual([
      { service: "notes", method: "create", ok: false, input: { title: "x", pages: "2" } },
      { service: "notes", method: "get", ok: true, input: { id: "1" } },
      { service: "notes", method: "broken", ok: false, input: undefined },
    ])
    expect((events[0].error as Response).status).toBe(403)
    expect(events[1].ctx).toBe(ctx)
    expect(events[1].ms).toBeGreaterThanOrEqual(0)
  })

  test("a throwing onCall doesn't fail the call", async () => {
    const loud = createApp({
      context,
      services: app.config.services,
      onCall: () => {
        throw new Error("audit down")
      },
    })
    const ctx = await loud.context({ caller: user(["notes:read"]) })
    expect(await ctx.services.notes.get({ id: "1" })).toMatchObject({ id: "1" })
  })

  test("service-to-service calls check the same caller", async () => {
    const tagsOnly = await app.context({ caller: user(["tags:read"]) })
    expect(await status(tagsOnly.services.tags.forNote({ id: "1" }))).toBe(403)
    const both = await app.context({ caller: user(["tags:read", "notes:read"]) })
    expect(await both.services.tags.forNote({ id: "1" })).toEqual({ tags: ["a"], title: "First" })
  })

  test("systemContext has a superadmin caller", async () => {
    const ctx = await app.systemContext({ workspaceId: "w9" })
    expect(ctx.caller.isSuperadmin).toBe(true)
    expect(await ctx.services.tags.forNote({ id: "1" })).toEqual({ tags: ["a"], title: "First" })
  })

  test("safe returns field errors from FormData or an object, and rethrows anything else", async () => {
    const ctx = await app.context({ caller: user(["notes:*"]) })
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
    expect(() => registry(createApp({ context, services: { a: named("has space") } }))).toThrow(
      'tool name "has space"',
    )
    expect(() =>
      registry(createApp({ context, services: { a: named("same"), b: named("same") } })),
    ).toThrow('a.x and b.x share the tool name "same"')
  })
})

describe("HTTP", () => {
  test("handle leaves other paths to the router and strips output to the contract", async () => {
    const ctx = await app.context({ caller: user(["notes:read"]) })
    expect(await app.handle(new Request("https://x.test/notes/1"), ctx)).toBeNull()
    const res = await app.handle(post("/api/notes.get", { id: "1" }), ctx)
    expect(await res?.json()).toEqual({ id: "1", title: "First" }) // no secret, no workspaceId
  })

  test("a method hidden by `when` answers like a missing one, whatever the verb", async () => {
    const ctx = await app.context({ caller: user(["notes:*"]) })
    const hidden = await app.handle(new Request("https://x.test/api/notes.reply"), ctx)
    const missing = await app.handle(new Request("https://x.test/api/notes.nope"), ctx)
    expect(hidden?.status).toBe(404)
    expect(missing?.status).toBe(404)
    const inThread = await app.context({ caller: user(["notes:*"]), thread: "t1" })
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

describe("discovery", () => {
  test("lists what the caller may call and what exists in its context", async () => {
    expect(await paths(await app.context({ caller: user(["notes:read"]) }))).toEqual([
      "/api/notes.list",
      "/api/notes.get",
      "/api/notes.snapshot",
      "/api/notes.broken",
    ])
    const writer = await app.context({ caller: user(["notes:write"]), thread: "t1" })
    expect(await paths(writer)).toEqual([
      "/api/notes.create",
      "/api/notes.remove",
      "/api/notes.reply",
    ])
  })

  test("an anonymous caller sees every method by default, and calls reach the method", async () => {
    const ctx = await app.context({ caller: anonymous() })
    expect((await paths(ctx)).length).toBe(7) // all but notes.reply, which needs a thread
    expect((await app.handle(post("/api/notes.get", { id: "1" }), ctx))?.status).toBe(403)
  })
  test("a contract's description is in openapi.json and llms.txt", async () => {
    const ctx = await app.context({ caller: user(["notes:write"]), thread: "t1" })
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
  const anon = () => closed.context({ caller: anonymous() })
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

  test("an authenticated caller is unaffected", async () => {
    const ctx = await closed.context({ caller: user(["notes:read"]) })
    expect(await paths(ctx, closed)).toContain("/api/notes.get")
  })
})
