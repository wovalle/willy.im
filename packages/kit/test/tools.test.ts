import { beforeEach, describe, expect, test, vi } from "vitest"
import { z } from "zod"
import { createApp, declareService, method, tools } from "../src/index.js"
import { app, context, events, reset, user } from "./fixture.js"

beforeEach(() => {
  reset()
  events.length = 0
})

const byName = async (grants: string[], thread: string | null = null) =>
  new Map(tools(app, await app.context({ caller: user(grants), thread })).map((t) => [t.name, t]))

describe("tools", () => {
  test("lists what the caller may call in this context", async () => {
    expect([...(await byName(["notes:read"])).keys()]).toEqual([
      "notes_list",
      "notes_get",
      "notes_snapshot",
      "notes_broken",
    ])
    expect([...(await byName(["notes:write"])).keys()]).toEqual(["notes_create", "notes_remove"])
    expect([...(await byName(["notes:write"], "t1")).keys()]).toContain("thread_reply")
  })

  test("a tool describes itself: title is the summary, description the long text, schemas as JSON Schema objects", async () => {
    const all = await byName(["notes:*"], "t1")
    expect(all.get("thread_reply")).toMatchObject({
      title: "Reply in the current thread.",
      description: "Posts the text as a reply. Only exists inside a thread.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      outputSchema: { type: "object", properties: { thread: { type: "string" } } },
    })
    expect(all.get("notes_get")?.description).toBe("Get a note by id.")
    expect(all.get("notes_list")?.inputSchema).toEqual({ type: "object", properties: {} })
    expect(all.get("notes_remove")?.hints).toEqual({ destructive: true, idempotent: true })
    expect(all.get("notes_get")?.inputZod.safeParse({ id: "1" }).success).toBe(true)
  })

  test("call returns the data stripped to the contract, through onCall", async () => {
    const r = await (await byName(["notes:read"])).get("notes_get")!.call({ id: "1" })
    expect(r).toEqual({ ok: true, data: { id: "1", title: "First" }, images: [] })
    expect(events.map((e) => e.method)).toEqual(["get"])
  })

  test("call pulls every kitImage out of the data and leaves a reference in its place", async () => {
    const r = await (await byName(["notes:read"])).get("notes_snapshot")!.call({ id: "1" })
    expect(r).toEqual({
      ok: true,
      data: {
        id: "1",
        image: { data: "(image 1, attached as an image block)", mediaType: "image/png" },
      },
      images: [{ data: "iVBORw0KGgo=", mediaType: "image/png" }],
    })
  })

  test("call turns a thrown Response or Error into a failure with a message and any fields", async () => {
    const all = await byName(["notes:*"])
    expect(await all.get("notes_get")!.call({ id: "404" })).toEqual({
      ok: false,
      message: "note not found",
    })
    expect(await all.get("notes_get")!.call({})).toEqual({
      ok: false,
      message: "invalid input",
      fields: { id: [expect.any(String)] },
    })
  })

  test("any other error reaches the caller as an internal error with an id, never its message", async () => {
    const leaky = createApp({
      context,
      services: {
        db: declareService(() => ({
          query: method({ summary: "q", permission: "notes:read" }, async () => {
            throw new Error("SQLITE_ERROR at postgres://admin:pw@db")
          }),
        })),
      },
    })
    const t = tools(leaky, await leaky.context({ caller: user(["notes:read"]) }))[0]
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const r = await t.call({})
    expect(r).toEqual({
      ok: false,
      message: expect.stringMatching(/^internal error \([0-9a-f]{8}\)$/),
    })
    expect(JSON.stringify(r)).not.toContain("postgres")
    const broken = await (await byName(["notes:read"])).get("notes_broken")!.call({})
    expect(broken).toMatchObject({ ok: false, message: expect.stringMatching(/^internal error/) })
    spy.mockRestore()
  })

  test("an input that isn't an object is wrapped as { input }", async () => {
    const search = createApp({
      context,
      services: {
        find: declareService(() => ({
          text: method(
            {
              summary: "s",
              permission: "notes:read",
              input: z.string(),
              output: { q: z.string() },
            },
            async (q) => ({ q }),
          ),
        })),
      },
    })
    const t = tools(search, await search.context({ caller: user(["notes:read"]) }))[0]
    expect(t.inputSchema).toEqual({
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
    })
    expect(Object.keys(t.inputZod.shape)).toEqual(["input"])
    expect(await t.call({ input: "hi" })).toEqual({ ok: true, data: { q: "hi" }, images: [] })
  })

  test("`permission: { resource }` shows the tool to anyone holding an instance or a wildcard", async () => {
    const threads = createApp({
      context,
      services: {
        thread: declareService((ctx) => ({
          read: method(
            { summary: "r", permission: { resource: "thread" }, input: { id: z.string() } },
            async ({ id }) => {
              ctx.caller.require(`thread:${id}`)
            },
          ),
        })),
      },
    })
    const names = async (grants: string[]) =>
      tools(threads, await threads.context({ caller: user(grants) })).map((t) => t.name)
    expect(await names(["thread:abc"])).toEqual(["thread_read"])
    expect(await names(["thread:*"])).toEqual(["thread_read"])
    expect(await names(["*"])).toEqual(["thread_read"])
    expect(await names(["notes:read"])).toEqual([])
    const [read] = tools(threads, await threads.context({ caller: user(["thread:abc"]) }))
    expect(await read.call({ id: "abc" })).toEqual({ ok: true, data: undefined, images: [] })
    expect(await read.call({ id: "xyz" })).toEqual({ ok: false, message: "Forbidden" })
  })
})
