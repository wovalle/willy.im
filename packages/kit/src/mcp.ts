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
import {
  optionalOut,
  tools,
  wrapSchema,
  type KitResult,
  type KitTool,
  type ToolContext,
} from "./tools.js"

export type McpOptions = {
  /** The server's `instructions`: a string, or computed from the tools this caller sees. */
  instructions?: string | ((tools: KitTool[]) => string | undefined)
}

/**
 * MCP wants `structuredContent` (and `outputSchema`) to be an object. An output
 * that isn't always one (an array, a string, an optional or nullable object)
 * goes in `{ result }`.
 */
function mcpOutput(t: KitTool) {
  const schema = t.outputSchema
  if (!schema || !t.outputZod) return undefined
  // Decided from the schema's definition, never by parsing probe values.
  if (t.outputZod._zod.def.type === "object") return { schema, wrap: false }
  return { schema: wrapSchema("result", schema, !optionalOut(t.outputZod)), wrap: true }
}

/** A kit tool as an MCP `Tool`, for apps that register tools on their own server. */
export const toMcpTool = (t: KitTool): Tool => {
  const out = mcpOutput(t)
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

/** A tool's result as an MCP `CallToolResult`. */
export function toCallToolResult(t: KitTool, r: KitResult): CallToolResult {
  if (!r.ok)
    return { isError: true, content: [{ type: "text", text: errorText(r.message, r.fields) }] }
  const out = mcpOutput(t)
  const images = r.images.map((i) => ({
    type: "image" as const,
    data: i.data,
    mimeType: i.mediaType,
  }))
  if (!out) return { content: [{ type: "text", text: "Done." }, ...images] }
  const structured = (
    out.wrap ? (r.data === undefined ? {} : { result: r.data }) : r.data
  ) as Record<string, unknown>
  return {
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(structured) ?? "null" }, ...images],
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
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: list.map(toMcpTool) }))
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const t = byName.get(request.params.name)
    if (!t) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`)
    return t.call(request.params.arguments ?? {}).then((r) => toCallToolResult(t, r))
  })
  return server
}
