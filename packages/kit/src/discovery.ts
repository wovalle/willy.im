import { z } from "zod"
import type { KitApp } from "./app.js"
import { available, toSchema } from "./method.js"
import type { PermissionChecker } from "./permissions.js"
import type { RegistryEntry } from "./registry.js"
import type { SchemaLike } from "./types.js"

export type JsonSchema = {
  type?: string
  format?: string
  enum?: unknown[]
  anyOf?: JsonSchema[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  default?: unknown
  description?: string
  [key: string]: unknown
}

/**
 * What discovery lists for a context: the methods that exist in it (`when`) and
 * that its caller may call. A caller with no credentials (`kind: "anonymous"`)
 * sees every method, as documentation, unless `discovery.anonymous` is "none".
 */
export function visibleTo(
  app: KitApp,
  entries: RegistryEntry[],
  ctx: { caller: PermissionChecker<any> & { kind?: string } },
) {
  const here = entries.filter((e) => available(e.contract, ctx))
  if (ctx.caller.kind === "anonymous") return app.config.discovery?.anonymous === "none" ? [] : here
  return here.filter((e) => ctx.caller.has(e.contract.permission))
}

/**
 * A contract schema as JSON Schema (2020-12, what OpenAPI 3.1 embeds). Dates are
 * ISO strings on the wire; a `format` makes zod's matching regex redundant.
 */
export function jsonSchema(schema: SchemaLike, io: "input" | "output"): JsonSchema {
  const { $schema: _, ...rest } = z.toJSONSchema(toSchema(schema), {
    io,
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === "date")
        Object.assign(jsonSchema, { type: "string", format: "date-time" })
      if (jsonSchema.format) delete jsonSchema.pattern
    },
  }) as JsonSchema
  return rest
}

const services = (app: KitApp, methods: RegistryEntry[]) =>
  Object.entries(app.config.services)
    .map(([name, factory]) => ({
      name,
      description: factory.description,
      methods: methods.filter((m) => m.service === name),
    }))
    .filter((s) => s.methods.length > 0)

const ref = (name: string) => ({ $ref: `#/components/responses/${name}` })

/** OpenAPI 3.1: one POST per method, tagged by service, behind a bearer key. */
export function openapi(app: KitApp, methods: RegistryEntry[], origin: string) {
  const errorSchema = {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
  }
  const paths = Object.fromEntries(
    methods.map((m) => {
      const { summary, description, permission, input, output } = m.contract
      const inputSchema = input && jsonSchema(input, "input")
      const operation = {
        operationId: m.name,
        tags: [m.service],
        summary,
        description: [description, `Requires the \`${permission}\` permission.`]
          .filter(Boolean)
          .join("\n\n"),
        "x-permission": permission,
        ...(inputSchema && {
          requestBody: {
            required: (inputSchema.required?.length ?? 0) > 0,
            content: { "application/json": { schema: inputSchema } },
          },
        }),
        responses: {
          ...(output
            ? {
                200: {
                  description: "OK",
                  content: { "application/json": { schema: jsonSchema(output, "output") } },
                },
              }
            : { 204: { description: "Done. No body." } }),
          ...(input && { 400: ref("InvalidInput") }),
          401: ref("Unauthorized"),
          403: ref("Forbidden"),
          404: ref("NotFound"),
          409: ref("Conflict"),
        },
      }
      return [`/api/${m.name}`, { post: operation }]
    }),
  )

  const error = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  })

  return {
    openapi: "3.1.0",
    info: {
      title: app.config.name ?? "API",
      version: "1",
      description: app.config.description ?? "",
    },
    servers: [{ url: origin }],
    tags: services(app, methods).map((s) => ({
      name: s.name,
      ...(s.description && { description: s.description }),
    })),
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: "An API key (`wak_…`) bound to this workspace.",
        },
      },
      schemas: {
        Error: errorSchema,
        InvalidInput: {
          type: "object",
          properties: {
            error: { type: "string" },
            fields: {
              type: "object",
              additionalProperties: { type: "array", items: { type: "string" } },
            },
          },
          required: ["error", "fields"],
        },
      },
      responses: {
        InvalidInput: {
          description:
            "The input doesn't match the method's schema. `fields` maps each field to its errors.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/InvalidInput" } },
          },
        },
        Unauthorized: error("No API key, or an invalid, revoked or expired one."),
        Forbidden: error("The key lacks the permission, or belongs to another workspace."),
        NotFound: error("No such record in this workspace."),
        Conflict: error(
          "The record's state doesn't allow this (for example, an invoice already sent).",
        ),
      },
    },
  }
}

/** The same methods as markdown, for a model reading plain text. */
export function llmsTxt(app: KitApp, methods: RegistryEntry[], origin: string): string {
  const lines = [`# ${app.config.name ?? "API"}`, ""]
  if (app.config.description) lines.push(`> ${app.config.description}`, "")
  lines.push(
    `Call a method with \`POST ${origin}/api/<service>.<method>\`, a JSON body (none when it takes no input) and \`Authorization: Bearer wak_…\`.`,
    "Errors are JSON `{ error }`; invalid input is a 400 `{ error, fields }`. Dates are ISO 8601 strings.",
    `OpenAPI 3.1: ${origin}/openapi.json`,
    "",
  )
  for (const service of services(app, methods)) {
    lines.push(`## ${service.name}`, "")
    if (service.description) lines.push(service.description, "")
    for (const m of service.methods) {
      const { summary, description, permission, input } = m.contract
      lines.push(`### ${m.name}`, "", summary, "")
      if (description) lines.push(description, "")
      lines.push(`Permission: \`${permission}\`.`)
      const inputFields = input ? fields(jsonSchema(input, "input")) : []
      lines.push(...(inputFields.length ? ["Input:", ...inputFields] : ["No input."]), "")
    }
  }
  return lines.join("\n")
}

function fields(schema: JsonSchema, prefix = ""): string[] {
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).flatMap(([key, p]) => {
    const name = `${prefix}${key}`
    const notes = [typeOf(p), required.has(key) ? "required" : "optional"]
    if (p.default !== undefined) notes.push(`default ${JSON.stringify(p.default)}`)
    const line = `- \`${name}\`: ${notes.join(", ")}${p.description ? `. ${p.description}` : ""}`
    const nested =
      p.type === "array" && p.items?.properties
        ? fields(p.items, `${name}[].`)
        : p.type === "object" && p.properties
          ? fields(p, `${name}.`)
          : []
    return [line, ...nested]
  })
}

function typeOf(p: JsonSchema): string {
  if (p.enum) return p.enum.map((v) => JSON.stringify(v)).join(" | ")
  if (p.anyOf) return p.anyOf.map(typeOf).join(" | ")
  if (p.type === "array") return `${p.items?.properties ? "object" : typeOf(p.items ?? {})}[]`
  if (p.format) return `${p.type} (${p.format})`
  return p.type ?? "any"
}
