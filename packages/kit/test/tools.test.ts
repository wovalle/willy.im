import { beforeEach, describe, expect, test } from "vitest"
import { tools } from "../src/index.js"
import { app, events, reset, user } from "./fixture.js"

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
    const broken = await all.get("notes_broken")!.call({})
    expect(broken).toMatchObject({
      ok: false,
      message: expect.stringContaining("output schema rejects"),
    })
  })
})
