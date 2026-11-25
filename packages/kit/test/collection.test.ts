import { beforeEach, describe, expect, test } from "vitest"
import { z } from "zod"
import { collection, createApp, declareService, registry, tools } from "../src/index.js"
import { app, auth, context, ctxFor, events, reset, rows, status } from "./fixture.js"

const seed = (titles: string[], tenant = "w1") => {
  for (const title of titles) {
    const id = String(rows.size + 1)
    rows.set(id, { id, title, workspaceId: tenant, secret: `secret-${id}` })
  }
}

beforeEach(() => {
  reset()
  events.length = 0
})

const post = (path: string, body?: unknown) =>
  new Request(`https://x.test${path}`, {
    method: "POST",
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

// Every page of the collection, following `next`, through `call`.
async function walk(call: (input: unknown) => Promise<any>, input: unknown = {}) {
  const pages: any[] = []
  let next: unknown = input
  while (next) {
    const page = await call(next)
    pages.push(page)
    next = page.next
  }
  return pages
}

describe("collection", () => {
  test("called with no input it returns the first page: default fields, default sort, default limit", async () => {
    seed(["b", "c", "d"])
    const ctx = await ctxFor(["notes:read"])
    const page = await ctx.services.notes.history()
    expect(page.rows).toEqual([
      { id: "4", title: "d" },
      { id: "3", title: "c" },
    ])
    expect(page.query).toEqual({
      where: {},
      select: ["id", "title"],
      sort: "id",
      dir: "desc",
      limit: 2,
    })
    expect(page.next).toMatchObject({ ...page.query, cursor: expect.any(String) })
  })

  test("sending `next` back unchanged walks every row exactly once, in order, to a null next", async () => {
    seed(["b", "c", "d", "e"])
    const ctx = await ctxFor(["notes:read"])
    const pages = await walk((i) => ctx.services.notes.history(i as never))
    expect(pages.flatMap((p) => p.rows.map((r: any) => r.id))).toEqual(["5", "4", "3", "2", "1"])
    expect(pages.at(-1).next).toBeNull()
  })

  test("rows that tie on the sort key are neither skipped nor repeated across a page boundary", async () => {
    seed(["same", "same", "same", "same"])
    const ctx = await ctxFor(["notes:read"])
    const pages = await walk((i) => ctx.services.notes.history(i as never), {
      sort: "title",
      dir: "asc",
    })
    const ids = pages.flatMap((p) => p.rows.map((r: any) => r.id))
    expect(ids).toEqual(["1", "2", "3", "4", "5"])
  })

  test("limit is clamped to the max, and the echoed query says so", async () => {
    seed(["b", "c", "d", "e"])
    const ctx = await ctxFor(["notes:read"])
    const page = await ctx.services.notes.history({ limit: 50 })
    expect(page.rows).toHaveLength(3)
    expect(page.query.limit).toBe(3)
  })

  test("where filters, and the next page keeps the filter", async () => {
    seed(["apple", "apricot", "banana", "avocado"])
    const ctx = await ctxFor(["notes:read"])
    const pages = await walk((i) => ctx.services.notes.history(i as never), {
      where: { q: "a" },
      sort: "title",
    })
    expect(pages.flatMap((p) => p.rows.map((r: any) => r.title))).toEqual([
      "apple",
      "apricot",
      "avocado",
      "banana",
    ])
    expect(pages[1].query.where).toEqual({ q: "a" })
  })

  test("select narrows the rows; `*` is every field the caller may see; hidden fields never come back", async () => {
    const reader = await ctxFor(["notes:read"])
    expect((await reader.services.notes.history({ select: ["title"] })).rows).toEqual([
      { title: "First" },
    ])
    expect((await reader.services.notes.history({ select: "*" })).rows).toEqual([
      { id: "1", title: "First" },
    ])
    const writer = await ctxFor(["notes:read", "notes:write"])
    expect((await writer.services.notes.history({ select: "*" })).rows).toEqual([
      { id: "1", title: "First", workspaceId: "w1" },
    ])
  })

  test("selecting a gated field the caller can't see is a 400 naming it", async () => {
    const ctx = await ctxFor(["notes:read"])
    const error = await ctx.services.notes
      .history({ select: ["id", "workspaceId"] })
      .catch((e) => e)
    expect(error).toBeInstanceOf(Response)
    expect(error.status).toBe(400)
    expect(await error.json()).toEqual({
      error: "invalid input",
      fields: { select: ["not available to you: workspaceId"] },
    })
  })

  test("a hidden field, an unknown field or an unknown sort is a 400", async () => {
    const ctx = await ctxFor(["notes:read"])
    expect(await status(ctx.services.notes.history({ select: ["secret"] } as never))).toBe(400)
    expect(await status(ctx.services.notes.history({ select: ["nope"] } as never))).toBe(400)
    expect(await status(ctx.services.notes.history({ sort: "nope" } as never))).toBe(400)
  })

  test("a cursor from another sort or direction, or a garbled one, is a 400 on cursor", async () => {
    seed(["b", "c"])
    const ctx = await ctxFor(["notes:read"])
    const { next } = await ctx.services.notes.history()
    expect(await status(ctx.services.notes.history({ ...next!, sort: "title" }))).toBe(400)
    expect(await status(ctx.services.notes.history({ ...next!, dir: "asc" }))).toBe(400)
    expect(await status(ctx.services.notes.history({ cursor: "nope" }))).toBe(400)
    expect(await status(ctx.services.notes.history({ cursor: btoa('{"s":"id"}') }))).toBe(400)
  })

  test("load is the only path to the data: rows outside the tenant never appear", async () => {
    seed(["mine"])
    seed(["theirs"], "w2")
    const ctx = await ctxFor(["notes:read"])
    const titles = (await walk((i) => ctx.services.notes.history(i as never))).flatMap((p) =>
      p.rows.map((r: any) => r.title),
    )
    expect(titles).toEqual(["mine", "First"])
  })

  test("a collection can read another service's collection", async () => {
    seed(["b"])
    const ctx = await ctxFor(["tags:read"])
    expect((await ctx.services.tags.titles()).rows).toEqual([{ title: "b" }, { title: "First" }])
  })

  test("a page carries meta when load returns it, and not when it doesn't", async () => {
    seed(["b", "c", "d"])
    const ctx = await ctxFor(["notes:read"])
    const [first, second] = await walk((i) => ctx.services.notes.history(i as never))
    expect(first.meta).toEqual({ matching: 4 })
    expect("meta" in second).toBe(false)
  })

  test("it is a method: the permission applies and onCall fires", async () => {
    const ctx = await ctxFor(["tags:read"])
    expect(await status(ctx.services.notes.history())).toBe(403)
    expect(events.at(-1)).toMatchObject({ method: "history", ok: false })
  })
})

describe("collection at the edges", () => {
  test("as a tool: the input schema teaches the grammar and the description how to page", async () => {
    const tool = tools(app, await ctxFor(["notes:read"])).find((t) => t.name === "notes_history")!
    expect(Object.keys(tool.inputSchema.properties as object)).toEqual([
      "where",
      "select",
      "sort",
      "dir",
      "limit",
      "cursor",
    ])
    expect(tool.inputSchema.required ?? []).toEqual([])
    expect(tool.description).toMatch(/^List notes, paged\.\n\nReturns one page: /)
    expect(tool.description).toContain("send `next` back unchanged")
    expect(tool.hints).toEqual({ readOnly: true })
  })

  test("as a tool: walking next to null returns every row once, without hidden fields", async () => {
    seed(["b", "c", "d"])
    const tool = tools(app, await ctxFor(["notes:read"])).find((t) => t.name === "notes_history")!
    const pages = await walk(
      async (i) => {
        const r = await tool.call(i)
        if (!r.ok) throw new Error(r.message)
        return r.data
      },
      { select: "*" },
    )
    const all = pages.flatMap((p) => p.rows)
    expect(all.map((r: any) => r.id)).toEqual(["4", "3", "2", "1"])
    expect(all.every((r: any) => !("secret" in r) && !("workspaceId" in r))).toBe(true)
    expect(pages[0].query).toMatchObject({ select: ["id", "title"], limit: 2 })
  })

  test("as a tool: meta passes through, declared in the output schema", async () => {
    seed(["b", "c"])
    const tool = tools(app, await ctxFor(["notes:read"])).find((t) => t.name === "notes_history")!
    const first = await tool.call({})
    if (!first.ok) throw new Error(first.message)
    expect(first.data).toMatchObject({ meta: { matching: 3 } })
    const second = await tool.call((first.data as any).next)
    if (!second.ok) throw new Error(second.message)
    expect(second.data).not.toHaveProperty("meta")
    expect(Object.keys(tool.outputSchema?.properties as object)).toContain("meta")
    expect(tool.outputSchema?.required ?? []).not.toContain("meta")
  })

  test("as a tool: a bad cursor comes back as a field error", async () => {
    const tool = tools(app, await ctxFor(["notes:read"])).find((t) => t.name === "notes_history")!
    expect(await tool.call({ cursor: "nope" })).toMatchObject({
      ok: false,
      fields: { cursor: [expect.any(String)] },
    })
  })

  test("over /api: no body is the first page, and next round-trips as the body", async () => {
    seed(["b", "c"])
    const ctx = await ctxFor(["notes:read"])
    const first = await (await app.handle(post("/api/notes.history"), ctx))!.json()
    expect(first.rows.map((r: any) => r.id)).toEqual(["3", "2"])
    const second = await (await app.handle(post("/api/notes.history", first.next), ctx))!.json()
    expect(second.rows.map((r: any) => r.id)).toEqual(["1"])
    expect(second.next).toBeNull()
  })

  test("registry(app) accepts a collection", () => {
    expect(registry(app).some((e) => e.name === "notes.history")).toBe(true)
  })
})

describe("collection with page paging", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `n${i + 1}` }))
  const svc = declareService(() => ({
    list: collection({
      summary: "List items.",
      permission: "notes:read",
      row: z.object({ id: z.int(), name: z.string() }),
      fields: { default: ["id", "name"] },
      where: { status: z.enum(["open", "all"]).optional() },
      // a context-dependent default; idempotent, so `next` keeps it
      normalize: (w) => ({ ...w, status: w.status ?? "open" }),
      sorts: { id: { dir: "asc", key: (r) => r.id } },
      defaultSort: "id",
      paging: "page",
      limit: { default: 2, max: 10 },
      load: ({ offset, limit }) => ({
        rows: items.slice(offset, offset + limit),
        total: items.length,
      }),
    }),
  }))
  const paged = createApp({ auth, context, services: { items: svc } } as never) as any

  test("pages by number with a total; next is page + 1 until the last page", async () => {
    const ctx = await paged.context(
      { id: "u", grants: [], memberships: [{ tenantId: "w1", grants: ["notes:read"] }] },
      "w1",
    )
    const pages = await walk((i) => ctx.services.items.list(i))
    expect(pages.map((p) => p.query.page)).toEqual([1, 2, 3])
    expect(pages.map((p) => p.total)).toEqual([5, 5, 5])
    expect(pages.flatMap((p) => p.rows.map((r: any) => r.id))).toEqual([1, 2, 3, 4, 5])
    expect(pages[2].next).toBeNull()
    expect(pages[1].query.where).toEqual({ status: "open" })
  })
})
