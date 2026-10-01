import { z } from "zod"
import type { KitApp } from "./app.js"
import { jsonSchema, type JsonSchema } from "./discovery.js"
import { splitImages, type KitImage } from "./image.js"
import { available, invalidFields, toSchema } from "./method.js"
import type { PermissionChecker } from "./permissions.js"
import { registry, type RegistryEntry } from "./registry.js"
import type { Hints } from "./types.js"

export type KitResult =
  | { ok: true; data: unknown; images: KitImage[] }
  | { ok: false; message: string; fields?: Partial<Record<string, string[]>> }

/** One method as a tool, for MCP and any agent runtime. */
export type KitTool = {
  /** `contract.name`, or `service_method`. */
  name: string
  /** The contract's summary. */
  title: string
  /** The contract's description, or its summary. */
  description: string
  /** JSON Schema with `type: "object"` at the root, as tool APIs require. */
  inputSchema: JsonSchema
  /** The input as zod, for runtimes that take zod (an empty object when there is none). */
  inputZod: z.ZodType
  /** JSON Schema of the output, as the contract declares it. */
  outputSchema?: JsonSchema
  hints?: Hints
  /**
   * Runs the method through the context's services (so `when`, the permission,
   * the input and `onCall` all apply) and never throws: data stripped to the
   * contract with images pulled out, or a failure with a message.
   */
  call: (args: unknown) => Promise<KitResult>
}

export type ToolContext = { caller: PermissionChecker<any>; services: object }

/** The schema with `type: "object"` at the root: as is, or `{ type: "object" }` if it isn't one. */
export function asObjectSchema(schema: JsonSchema | undefined): JsonSchema {
  if (!schema) return { type: "object", properties: {} }
  if (schema.type === "object") return schema
  const branches = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined
  if (!schema.type && branches?.length && branches.every((b) => b.type === "object"))
    return { type: "object", ...schema }
  return { type: "object" }
}

/** JSON-safe: dates become ISO strings, undefined keys go. */
const toJson = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

async function failure(err: unknown): Promise<KitResult> {
  if (err instanceof Response) {
    const fields = invalidFields(err)
    const text = await err
      .clone()
      .text()
      .catch(() => "")
    let message = text
    try {
      const body = JSON.parse(text)
      if (typeof body?.error === "string") message = body.error
    } catch {}
    return {
      ok: false,
      message: message || `failed with status ${err.status}`,
      ...(fields && { fields }),
    }
  }
  return { ok: false, message: err instanceof Error ? err.message : String(err) }
}

function toTool(e: RegistryEntry, ctx: ToolContext): KitTool {
  const { summary, description, input, output, hints } = e.contract
  const fn = (
    ctx.services as Record<string, Record<string, (input?: unknown) => Promise<unknown>>>
  )[e.service][e.method]
  return {
    name: e.tool,
    title: summary,
    description: description ?? summary,
    inputSchema: asObjectSchema(input && jsonSchema(input, "input")),
    inputZod: input ? toSchema(input) : z.object({}),
    ...(output && { outputSchema: jsonSchema(output, "output") }),
    ...(hints && { hints }),
    call: async (args) => {
      try {
        const result = await (input ? fn(args ?? {}) : fn())
        if (!output) return { ok: true, data: undefined, images: [] }
        // The method already passed its output check; this parse strips undeclared keys and tags images.
        const { data, images } = splitImages(toSchema(output).parse(result))
        return { ok: true, data: toJson(data), images }
      } catch (err) {
        return failure(err)
      }
    },
  }
}

/**
 * The methods this context may call, as tools: those that exist here (`when`)
 * and whose permission the caller has. Every adapter (MCP, an agent runtime)
 * starts from this list, so they all see the same thing.
 */
export function tools(app: KitApp, ctx: ToolContext): KitTool[] {
  return registry(app)
    .filter((e) => available(e.contract, ctx) && ctx.caller.has(e.contract.permission))
    .map((e) => toTool(e, ctx))
}
