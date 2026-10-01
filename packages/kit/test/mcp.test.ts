import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { beforeEach, describe, expect, test } from "vitest"
import { toMcpServer, type McpOptions } from "../src/mcp.js"
import { app, reset, user } from "./fixture.js"

beforeEach(reset)

async function connect(grants: string[], thread: string | null = null, options?: McpOptions) {
  const server = toMcpServer(app, await app.context({ caller: user(grants), thread }), options)
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

  test("instructions can be computed from the tools the caller sees", async () => {
    const instructions = (tools: { name: string }[]) =>
      tools.some((t) => t.name === "thread_reply") ? "Reply in the thread." : undefined
    expect((await connect(["notes:*"], "t1", { instructions })).getInstructions()).toBe(
      "Reply in the thread.",
    )
    expect((await connect(["notes:*"], null, { instructions })).getInstructions()).toBeUndefined()
  })
})
