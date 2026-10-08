/**
 * `@willyim/kit/mcp`: an MCP server over the caller's tools. kit builds the
 * server; the app brings the transport (Streamable HTTP on Hono, Workers, …)
 * and the authentication that produced `ctx`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
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
import type { View } from "./types.js"

/** The MIME type of an MCP Apps view. */
export const VIEW_MIME_TYPE = "text/html;profile=mcp-app"

/** A view's `_meta.ui`: its CSP and border preference, when it sets any. */
function viewMeta(view: View) {
  if (view.csp === undefined && view.prefersBorder === undefined) return undefined
  return {
    ui: {
      ...(view.csp && { csp: view.csp }),
      ...(view.prefersBorder !== undefined && { prefersBorder: view.prefersBorder }),
    },
  }
}

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
    ...(t.ui && {
      _meta: {
        ui: {
          resourceUri: t.ui.resourceUri,
          ...(t.ui.visibility && { visibility: t.ui.visibility }),
        },
      },
    }),
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
 * - MCP Apps: `resources/list` and `resources/read` serve the views the
 *   caller's tools render (`text/html;profile=mcp-app`); any other URI is
 *   "Unknown resource". Without `views`, no resources capability.
 *
 * Build one per request or session: the list is fixed when it's built.
 */
export function toMcpServer(app: KitApp, ctx: ToolContext, options: McpOptions = {}): Server {
  const list = tools(app, ctx)
  const byName = new Map(list.map((t) => [t.name, t]))
  const instructions =
    typeof options.instructions === "function" ? options.instructions(list) : options.instructions
  const views = app.config.views ?? {}
  // Only the views a tool this caller sees renders.
  const visibleViews = new Map(
    list.flatMap((t) => (t.ui ? [[t.ui.resourceUri, t.ui.view] as const] : [])),
  )
  const server = new Server(
    { name: app.config.name ?? "kit", version: "1.0.0" },
    {
      capabilities: { tools: {}, ...(Object.keys(views).length > 0 && { resources: {} }) },
      ...(instructions && { instructions }),
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: list.map(toMcpTool) }))
  if (Object.keys(views).length > 0) {
    server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: [...visibleViews].map(([uri, name]) => {
        const meta = viewMeta(views[name])
        return { uri, name, mimeType: VIEW_MIME_TYPE, ...(meta && { _meta: meta }) }
      }),
    }))
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params
      const name = visibleViews.get(uri)
      // MCP's "resource not found"
      if (name === undefined) throw new McpError(-32002, `Unknown resource: ${uri}`)
      const view = views[name]
      const text = typeof view.html === "string" ? view.html : await view.html()
      const meta = viewMeta(view)
      return { contents: [{ uri, mimeType: VIEW_MIME_TYPE, text, ...(meta && { _meta: meta }) }] }
    })
  }
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const t = byName.get(request.params.name)
    if (!t) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`)
    return t.call(request.params.arguments ?? {}).then((r) => toCallToolResult(t, r))
  })
  return server
}
