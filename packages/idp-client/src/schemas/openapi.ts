/**
 * The published OpenAPI document, built from `./operations.ts`.
 *
 * `apps/idp` serves this at `/api/v1/openapi.json`; `npm run openapi` writes
 * the same object to `openapi/idp-api.json` so the snapshot in the repo is
 * always what the server would answer.
 */

import { z } from "zod"

import { lookup, operations, type OperationDef, type QueryParam } from "./operations.js"

/**
 * Responses describe what the API *returns*, so they use zod's output types.
 * Request bodies describe what a caller may *send*, which is a different shape:
 * a field with a `.default()` is optional on the way in and guaranteed on the
 * way out. Emitting output types for both would mark every defaulted field
 * `required` and force callers to supply values the API would have defaulted.
 */
const json = (schema: z.ZodType) => z.toJSONSchema(schema)
const jsonInput = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input" })

const DESCRIPTION =
  "Management API for the willy.im identity provider. Authenticate with `Authorization: Bearer <token>`. Two kinds of token: the superadmin `ADMIN_API_TOKEN` (every app) and per-app **scoped API keys** minted in the admin console (one app, a fixed permission set). The cross-app endpoints below require the superadmin token."

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
}

function parametersFor(path: string, def: OperationDef) {
  const pathParams = pathParamNames(path).map((name) => ({
    name,
    in: "path",
    required: true,
    ...(def.params?.[name] ? { description: def.params[name] } : {}),
    schema: { type: "string" },
  }))
  const queryParams = (def.query ?? []).map((param: QueryParam) => ({
    name: param.name,
    in: "query",
    required: param.required ?? false,
    ...(param.description ? { description: param.description } : {}),
    schema: { type: "string" },
  }))
  return [...pathParams, ...queryParams]
}

function operationObject(method: string, path: string, def: OperationDef) {
  const scoped = def.permission !== undefined
  const write = method !== "get"
  const parameters = parametersFor(path, def)
  return {
    summary: def.summary,
    description:
      def.description ??
      (scoped
        ? `Requires \`${def.permission}\` on the path app (or the superadmin token).`
        : "Requires the superadmin token."),
    security: [{ bearerAuth: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(def.input
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: jsonInput(def.input) } },
          },
        }
      : {}),
    responses: {
      [def.successCode]: {
        description: "OK",
        content: { "application/json": { schema: json(def.success) } },
      },
      "401": { description: "Missing or invalid bearer token" },
      ...(scoped
        ? { "403": { description: "Key lacks the permission / is bound to another app" } }
        : {}),
      ...(write
        ? {
            "405": {
              description: "Method not allowed on this resource (see the `Allow` header)",
            },
            "409": { description: "Conflict (already a member, last admin, slug taken, …)" },
          }
        : {}),
      ...(def.notFound ? { "404": { description: def.notFound } } : {}),
      ...(def.input ? { "422": { description: "Body failed validation" } } : {}),
    },
  }
}

export function buildOpenApiDocument(input: { baseUrl: string }) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const key of Object.keys(operations)) {
    const [method, path] = key.split(" ") as [string, string]
    const def = lookup(method, path)
    if (!def) continue
    paths[path] ??= {}
    paths[path][method] = operationObject(method, path, def)
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "willy.im IdP — Management API",
      version: "1.0.0",
      description: DESCRIPTION,
    },
    servers: [{ url: input.baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Superadmin ADMIN_API_TOKEN or a scoped API key (wim_…).",
        },
      },
    },
    paths,
  }
}
