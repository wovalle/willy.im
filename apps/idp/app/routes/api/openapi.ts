import { z } from "zod"

import type { Route } from "./+types/openapi"
import {
  ApplicationListSchema,
  UserListSchema,
  WorkspaceListSchema,
} from "~/lib/api-schemas"

const json = (schema: z.ZodType) => z.toJSONSchema(schema)

const bearerGet = (summary: string, responseSchema: z.ZodType) => ({
  get: {
    summary,
    security: [{ bearerAuth: [] }],
    responses: {
      "200": {
        description: "OK",
        content: { "application/json": { schema: json(responseSchema) } },
      },
      "401": { description: "Missing or invalid bearer token" },
    },
  },
})

export async function loader({ context }: Route.LoaderArgs) {
  const baseUrl = context.getAppEnv("BETTER_AUTH_URL")
  const doc = {
    openapi: "3.1.0",
    info: {
      title: "willy.im IdP — Management API",
      version: "1.0.0",
      description:
        "Management API for the willy.im identity provider. Authenticate with `Authorization: Bearer <token>`. Two kinds of token: the superadmin `ADMIN_API_TOKEN` (every app) and per-app **scoped API keys** minted in the admin console (one app, a fixed permission set). The cross-app list endpoints below require the superadmin token. Application registration is done in the admin console (better-auth ties client creation to an admin session).",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Superadmin ADMIN_API_TOKEN or a scoped API key (wim_…).",
        },
      },
    },
    paths: {
      "/api/v1/applications": bearerGet("List registered applications", ApplicationListSchema),
      "/api/v1/users": bearerGet("List users", UserListSchema),
      "/api/v1/workspaces": bearerGet("List workspaces", WorkspaceListSchema),
    },
  }
  return Response.json(doc)
}
