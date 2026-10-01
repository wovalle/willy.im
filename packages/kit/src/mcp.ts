/**
 * `@willyim/kit/mcp`: an MCP server over the caller's tools. kit builds the
 * server; the app brings the transport (Streamable HTTP on Hono, Workers, …)
 * and the authentication that produced `ctx`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import type { KitApp } from "./app.js"
import type { JsonSchema } from "./discovery.js"
import { tools, type KitTool, type ToolContext } from "./tools.js"

export type McpOptions = {
  /** The server's `instructions`: a string, or computed from the tools this caller sees. */
  instructions?: string | ((tools: KitTool[]) => string | undefined)
}

/**
 * MCP wants `structuredContent` (and `outputSchema`) to be an object. An output
 * that isn't one (an array, a nullable object, a string) goes in `{ result }`.
 */
function mcpOutput(schema: JsonSchema | undefined) {
  if (!schema) return undefined
  if (schema.type === "object") return { schema, wrap: false }
  const { $defs, ...inner } = schema
  return {
    schema: {
      type: "object",
      properties: { result: inner },
      required: ["result"],
      ...($defs !== undefined && { $defs }),
    } as JsonSchema,
    wrap: true,
  }
}

const describe = (t: KitTool): Tool => {
  const out = mcpOutput(t.outputSchema)
  const annotations = t.hints && {
    ...(t.hints.readOnly !== undefined && { readOnlyHint: t.hints.readOnly }),
    ...(t.hints.destructive !== undefined && { destructiveHint: t.hints.destructive }),
    ...(t.hints.idempotent !== undefined && { idempotentHint: t.hints.idempotent }),
  }
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema as Tool["inputSchema"],
    ...(out && { outputSchema: out.schema as Tool["outputSchema"] }),
    ...(annotations && Object.keys(annotations).length > 0 && { annotations }),
  }
}

const errorText = (message: string, fields?: Partial<Record<string, string[]>>) =>
  [
    message,
    ...Object.entries(fields ?? {}).map(([field, errors]) => `- ${field}: ${errors?.join("; ")}`),
  ].join("\n")

async function call(t: KitTool, args: unknown): Promise<CallToolResult> {
  const r = await t.call(args)
  if (!r.ok)
    return { isError: true, content: [{ type: "text", text: errorText(r.message, r.fields) }] }
  const out = mcpOutput(t.outputSchema)
  const images = r.images.map((i) => ({
    type: "image" as const,
    data: i.data,
    mimeType: i.mediaType,
  }))
  if (!out) return { content: [{ type: "text", text: "Done." }, ...images] }
  const structured = (out.wrap ? { result: r.data } : r.data) as Record<string, unknown>
  return {
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(structured) }, ...images],
  }
}

/**
 * An MCP server listing and calling the tools `ctx` may use (`tools(app, ctx)`):
 *
 * - `tools/list`: name, title, description, input and output JSON Schema, hints
 *   as annotations.
 * - `tools/call`: `structuredContent`, the same JSON as a text block, and one
 *   image block per `kitImage` in the output. A failure is an `isError` result
 *   whose text carries the message and any invalid-input fields.
 * - A tool outside the caller's list, forbidden or nonexistent, is the same
 *   "Unknown tool" protocol error.
 *
 * Build one per request or session: the list is fixed when it's built.
 */
export function toMcpServer(app: KitApp, ctx: ToolContext, options: McpOptions = {}): Server {
  const list = tools(app, ctx)
  const byName = new Map(list.map((t) => [t.name, t]))
  const instructions =
    typeof options.instructions === "function" ? options.instructions(list) : options.instructions
  const server = new Server(
    { name: app.config.name ?? "kit", version: "1.0.0" },
    { capabilities: { tools: {} }, ...(instructions && { instructions }) },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: list.map(describe) }))
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const t = byName.get(request.params.name)
    if (!t) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`)
    return call(t, request.params.arguments ?? {})
  })
  return server
}
