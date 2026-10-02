import { z } from "zod"
import type { KitApp } from "./app.js"
import { jsonSchema, type JsonSchema } from "./discovery.js"
import { splitImages, type KitImage } from "./image.js"
import { available, invalidFields, invoke, isPublicError, permitted, toSchema } from "./method.js"
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
  /**
   * JSON Schema with `type: "object"` at the root, as tool APIs require. An input
   * that isn't a `z.object` is wrapped as `{ input: <schema> }` and unwrapped on call.
   */
  inputSchema: JsonSchema
  /** The same input as a zod object, for runtimes that take zod (`inputZod.shape`). */
  inputZod: z.ZodObject
  /** JSON Schema of the output, as the contract declares it. */
  outputSchema?: JsonSchema
  /** The output as zod. */
  outputZod?: z.ZodType
  hints?: Hints
  /**
   * Runs the method through the context's services (so `when`, the permission,
   * the input, the output check and `onCall` all apply) and never throws: data
   * stripped to the contract with images pulled out, or a failure. Only errors meant for callers
   * (a thrown `Response`: `fail()`, 400, 403, 404) carry their message; anything
   * else is "internal error" with an id, and the error itself is logged.
   */
  call: (args: unknown) => Promise<KitResult>
}

export type ToolContext = { caller: PermissionChecker<any, any>; services: object }

/** JSON-safe: dates become ISO strings, undefined keys go. */
const toJson = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

async function failure(err: unknown, tool: string): Promise<KitResult> {
  // Only errors kit made for callers (fail(), 400, 403, 404, the caller's denials)
  // pass their message on. A Response from anywhere else (an upstream fetch) is internal.
  if (isPublicError(err)) {
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
  const id = crypto.randomUUID().slice(0, 8)
  console.error(`kit: ${tool} failed (error ${id})`, err)
  return { ok: false, message: `internal error (${id})` }
}

const isZodObject = (s: z.ZodType): s is z.ZodObject => s._zod.def.type === "object"

/** `{ type: "object", properties: { [key]: schema } }`, with `$defs` kept at the root so refs resolve. */
export function wrapSchema(key: string, schema: JsonSchema, required: boolean): JsonSchema {
  const { $defs, ...inner } = schema
  return {
    type: "object",
    properties: { [key]: inner },
    required: required ? [key] : [],
    ...($defs !== undefined && { $defs }),
  }
}

/** May the schema's value be absent? */
export const optionalIn = (s: z.ZodType) => s._zod.optin === "optional"
export const optionalOut = (s: z.ZodType) => s._zod.optout === "optional"

function toTool(e: RegistryEntry, ctx: ToolContext): KitTool {
  const { summary, description, input, output, hints } = e.contract
  const bound = (ctx.services as Record<string, Record<string, unknown>>)[e.service][e.method]
  const inputZod = input ? toSchema(input) : undefined
  const wrapped = inputZod !== undefined && !isZodObject(inputZod)
  const outputZod = output && toSchema(output)
  return {
    name: e.tool,
    title: summary,
    description: description ?? summary,
    inputSchema: !input
      ? { type: "object", properties: {} }
      : wrapped
        ? wrapSchema("input", jsonSchema(input, "input"), !optionalIn(inputZod))
        : jsonSchema(input, "input"),
    inputZod: !inputZod
      ? z.object({})
      : wrapped
        ? z.object({ input: inputZod })
        : (inputZod as z.ZodObject),
    ...(output && { outputSchema: jsonSchema(output, "output"), outputZod }),
    ...(hints && { hints }),
    call: async (args) => {
      try {
        const value = (args ?? {}) as Record<string, unknown>
        const parsed = await invoke(bound, input ? (wrapped ? value.input : value) : undefined)
        if (!output) return { ok: true, data: undefined, images: [] }
        const { data, images } = splitImages(parsed)
        return { ok: true, data: toJson(data), images }
      } catch (err) {
        const r = await failure(err, e.name)
        // A wrapped input's own errors belong to the `input` field the tool advertises.
        if (wrapped && !r.ok && r.fields?._) {
          const { _, ...rest } = r.fields
          return { ...r, fields: { input: _, ...rest } }
        }
        return r
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
    .filter((e) => available(e.contract, ctx) && permitted(ctx.caller, e.contract.permission))
    .map((e) => toTool(e, ctx))
}
