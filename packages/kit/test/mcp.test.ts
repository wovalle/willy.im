import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { beforeEach, describe, expect, test } from "vitest"
import { z } from "zod"
import { createApp, declareService, method, tools, type Grant } from "../src/index.js"
import { toMcpServer, type McpOptions } from "../src/mcp.js"
import { app, auth, context, ctxFor, member, reset } from "./fixture.js"

beforeEach(reset)

async function connect(grants: Grant[], thread: string | null = null, options?: McpOptions) {
  const server = toMcpServer(app, await ctxFor(grants, thread), options)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "1" })
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

describe("MCP", () => {
  test("tools/list shows the caller's tools with schemas and hints as annotations", async () => {
    const client = await connect(["notes:*"], "t1")
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual([
      "notes_list",
      "notes_get",
      "notes_create",
      "notes_remove",
      "thread_reply",
      "notes_snapshot",
      "notes_broken",
    ])
    const remove = tools.find((t) => t.name === "notes_remove")!
    expect(remove).toMatchObject({
      title: "Delete a note.",
      inputSchema: { type: "object", required: ["id"] },
      annotations: { destructiveHint: true, idempotentHint: true },
    })
    expect(remove.outputSchema).toBeUndefined()
    // an array output is wrapped, since structuredContent must be an object
    expect(tools.find((t) => t.name === "notes_list")!.outputSchema).toMatchObject({
      type: "object",
      properties: { result: { type: "array" } },
      required: ["result"],
    })
  })

  test("a forbidden tool and a nonexistent one are the same unknown-tool error", async () => {
    const client = await connect(["notes:read"])
    const forbidden = await client
      .callTool({ name: "notes_create", arguments: { title: "x" } })
      .catch((e) => e)
    const hidden = await client
      .callTool({ name: "thread_reply", arguments: { text: "x" } })
      .catch((e) => e)
    const missing = await client.callTool({ name: "nope", arguments: {} }).catch((e) => e)
    expect(forbidden.code).toBe(-32602)
    expect(forbidden.message).toContain("Unknown tool: notes_create")
    expect(hidden.message).toContain("Unknown tool: thread_reply")
    expect(missing.message).toContain("Unknown tool: nope")
  })

  test("tools/call returns structuredContent, the same JSON as text, and an image block per kitImage", async () => {
    const client = await connect(["notes:read"])
    const r = await client.callTool({ name: "notes_snapshot", arguments: { id: "1" } })
    const data = {
      id: "1",
      image: { data: "(image 1, attached as an image block)", mediaType: "image/png" },
    }
    expect(r.structuredContent).toEqual(data)
    expect(r.content).toEqual([
      { type: "text", text: JSON.stringify(data) },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    ])
    const list = await client.callTool({ name: "notes_list", arguments: {} })
    expect(list.structuredContent).toEqual({ result: [{ id: "1", title: "First" }] })
  })

  test("a failure is an isError result carrying the message and the invalid fields", async () => {
    const client = await connect(["notes:*"])
    const invalid = await client.callTool({ name: "notes_create", arguments: { title: "" } })
    expect(invalid.isError).toBe(true)
    expect((invalid.content as { text: string }[])[0].text).toMatch(
      /^invalid input\n- title: .+\n- pages: .+$/,
    )
    const missing = await client.callTool({ name: "notes_get", arguments: { id: "404" } })
    expect(missing).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "note not found" }],
    })
  })

  test("an optional output is wrapped, and an absent one is an empty structuredContent", async () => {
    const maybe = createApp({
      auth,
      context,
      services: {
        x: declareService(() => ({
          y: method(
            {
              summary: "y",
              permission: "notes:read",
              input: { found: z.boolean() },
              output: z.object({ id: z.string() }).optional(),
            },
            async ({ found }) => (found ? { id: "1" } : undefined),
          ),
        })),
      },
    })
    const server = toMcpServer(maybe, await maybe.context(member("w1", ["notes:read"]), "w1"))
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "1" })
    await Promise.all([server.connect(a), client.connect(b)])
    const [tool] = (await client.listTools()).tools
    expect(tool.outputSchema).toMatchObject({
      properties: { result: { type: "object" } },
      required: [],
    })
    expect(
      (await client.callTool({ name: "x_y", arguments: { found: true } })).structuredContent,
    ).toEqual({
      result: { id: "1" },
    })
    const none = await client.callTool({ name: "x_y", arguments: { found: false } })
    expect(none.structuredContent).toEqual({})
    expect(none.content).toEqual([{ type: "text", text: "{}" }])
  })

  test("instructions can be computed from the tools the caller sees", async () => {
    const instructions = (tools: { name: string }[]) =>
      tools.some((t) => t.name === "thread_reply") ? "Reply in the thread." : undefined
    expect((await connect(["notes:*"], "t1", { instructions })).getInstructions()).toBe(
      "Reply in the thread.",
    )
    expect((await connect(["notes:*"], null, { instructions })).getInstructions()).toBeUndefined()
  })
})

describe("MCP Apps", () => {
  const board = createApp({
    name: "board",
    auth,
    context,
    services: {
      cards: declareService(() => ({
        show: method(
          {
            summary: "Show a card.",
            permission: "notes:read",
            output: { id: z.string() },
            ui: { view: "card" },
          },
          async () => ({ id: "1" }),
        ),
        refresh: method(
          {
            summary: "Refresh the board.",
            permission: "notes:write",
            ui: { view: "board", visibility: ["app"] },
          },
          async () => {},
        ),
        plain: method({ summary: "No view.", permission: "notes:read" }, async () => {}),
      })),
    },
    views: {
      card: { html: "<p>card</p>", prefersBorder: true },
      board: {
        html: async () => "<p>board</p>",
        csp: { connectDomains: ["https://api.example.com"] },
      },
      unused: { html: "<p>unused</p>" },
    },
  })

  async function connectBoard(grants: Grant[]) {
    const server = toMcpServer(board, await board.context(member("w1", grants), "w1"))
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "1" })
    await Promise.all([server.connect(a), client.connect(b)])
    return client
  }

  test("a tool with a view carries _meta.ui.resourceUri and its visibility; one without is unchanged", async () => {
    const { tools } = await (await connectBoard(["notes:*"])).listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(byName.cards_show._meta).toEqual({ ui: { resourceUri: "ui://board/card" } })
    expect(byName.cards_refresh._meta).toEqual({
      ui: { resourceUri: "ui://board/board", visibility: ["app"] },
    })
    expect(byName.cards_plain._meta).toBeUndefined()
  })

  test("tools() passes the view through for runtimes that render natively", async () => {
    const list = tools(board, await board.context(member("w1", ["notes:*"]), "w1"))
    expect(list.find((t) => t.name === "cards_refresh")!.ui).toEqual({
      view: "board",
      resourceUri: "ui://board/board",
      visibility: ["app"],
    })
    expect(list.find((t) => t.name === "cards_plain")!.ui).toBeUndefined()
  })

  test("resources/list shows the views of the caller's tools, with their _meta.ui", async () => {
    const { resources } = await (await connectBoard(["notes:*"])).listResources()
    expect(resources).toEqual([
      {
        uri: "ui://board/card",
        name: "card",
        mimeType: "text/html;profile=mcp-app",
        _meta: { ui: { prefersBorder: true } },
      },
      {
        uri: "ui://board/board",
        name: "board",
        mimeType: "text/html;profile=mcp-app",
        _meta: { ui: { csp: { connectDomains: ["https://api.example.com"] } } },
      },
    ])
  })

  test("resources/read serves the view's HTML, from a string or a function", async () => {
    const client = await connectBoard(["notes:*"])
    expect((await client.readResource({ uri: "ui://board/card" })).contents).toEqual([
      {
        uri: "ui://board/card",
        mimeType: "text/html;profile=mcp-app",
        text: "<p>card</p>",
        _meta: { ui: { prefersBorder: true } },
      },
    ])
    expect((await client.readResource({ uri: "ui://board/board" })).contents).toMatchObject([
      { text: "<p>board</p>" },
    ])
  })

  test("a view whose tools the caller can't see is neither listed nor readable", async () => {
    const client = await connectBoard(["notes:read"])
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri)).toEqual(["ui://board/card"])
    const hidden = await client.readResource({ uri: "ui://board/board" }).catch((e) => e)
    expect(hidden.code).toBe(-32002)
    expect(hidden.message).toContain("Unknown resource: ui://board/board")
  })

  test("an unknown or unreferenced view is the same unknown-resource error", async () => {
    const client = await connectBoard(["notes:*"])
    const unused = await client.readResource({ uri: "ui://board/unused" }).catch((e) => e)
    const missing = await client.readResource({ uri: "ui://board/nope" }).catch((e) => e)
    expect(unused.message).toContain("Unknown resource: ui://board/unused")
    expect(missing.message).toContain("Unknown resource: ui://board/nope")
  })

  test("an app without views has no resources capability", async () => {
    const client = await connect(["notes:*"])
    expect(client.getServerCapabilities()?.resources).toBeUndefined()
  })

  test("createApp throws on a method whose view isn't declared", () => {
    const services = {
      x: declareService(() => ({
        y: method({ summary: "y", permission: "notes:read", ui: { view: "nope" } }, async () => {}),
      })),
    }
    // @ts-expect-error "x.y renders view "nope", which createApp's views doesn't declare"
    expect(() => createApp({ auth, context, services })).toThrow(
      'kit: x.y renders view "nope", which views doesn\'t declare',
    )
  })
})
