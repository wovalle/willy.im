import { z } from "zod"

import type { Route } from "./+types/openapi"
import {
  ApplicationListSchema,
  AuditListSchema,
  CreateUserApiKeyInput,
  CreateWorkspaceInput,
  InviteMemberInput,
  InviteMemberResult,
  MemberListSchema,
  OkSchema,
  UpdateMemberInput,
  UserApiKeyCreatedSchema,
  UserApiKeyListSchema,
  UserApiKeyValidationSchema,
  UserListSchema,
  ValidateUserApiKeyInput,
  WorkspaceCreatedSchema,
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

/** Path param shared by all per-app operations. */
const appParam = {
  name: "app",
  in: "path",
  required: true,
  description: "Application key (oauth_client.metadata.app).",
  schema: { type: "string" },
}
const userIdParam = {
  name: "userId",
  in: "path",
  required: true,
  schema: { type: "string" },
}

const jsonContent = (schema: z.ZodType) => ({
  content: { "application/json": { schema: json(schema) } },
})

const scopedGet = (summary: string, permission: string, responseSchema: z.ZodType) => ({
  summary,
  description: `Requires \`${permission}\` on the path app (or the superadmin token).`,
  security: [{ bearerAuth: [] }],
  parameters: [appParam],
  responses: {
    "200": { description: "OK", ...jsonContent(responseSchema) },
    "401": { description: "Missing or invalid bearer token" },
    "403": { description: "Key lacks the permission / is bound to another app" },
  },
})

const scopedWrite = (opts: {
  summary: string
  permission: string
  input?: z.ZodType
  success: { code: "200" | "201"; schema: z.ZodType }
  extraParams?: object[]
}) => ({
  summary: opts.summary,
  description: `Requires \`${opts.permission}\` on the path app (or the superadmin token).`,
  security: [{ bearerAuth: [] }],
  parameters: [appParam, ...(opts.extraParams ?? [])],
  ...(opts.input
    ? { requestBody: { required: true, ...jsonContent(opts.input) } }
    : {}),
  responses: {
    [opts.success.code]: { description: "OK", ...jsonContent(opts.success.schema) },
    "401": { description: "Missing or invalid bearer token" },
    "403": { description: "Key lacks the permission / is bound to another app" },
    "409": { description: "Conflict (already a member, last admin, slug taken, …)" },
    "422": { description: "Body failed validation" },
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

      "/api/v1/apps/{app}/members": {
        get: scopedGet("List app members", "member:read", MemberListSchema),
        post: scopedWrite({
          summary: "Add or invite a member",
          permission: "member:invite",
          input: InviteMemberInput,
          success: { code: "201", schema: InviteMemberResult },
        }),
      },
      "/api/v1/apps/{app}/members/{userId}": {
        patch: scopedWrite({
          summary: "Update a member's role + permissions",
          permission: "member:manage",
          input: UpdateMemberInput,
          success: { code: "200", schema: OkSchema },
          extraParams: [userIdParam],
        }),
        delete: scopedWrite({
          summary: "Remove a member",
          permission: "member:manage",
          success: { code: "200", schema: OkSchema },
          extraParams: [userIdParam],
        }),
      },
      "/api/v1/apps/{app}/workspaces": {
        get: scopedGet("List app workspaces", "workspace:read", WorkspaceListSchema),
        post: scopedWrite({
          summary: "Create a workspace",
          permission: "workspace:create",
          input: CreateWorkspaceInput,
          success: { code: "201", schema: WorkspaceCreatedSchema },
        }),
      },
      "/api/v1/apps/{app}/user-keys": {
        get: scopedGet(
          "List end-user API keys (filter: ?userId=&workspaceId=)",
          "userkey:read",
          UserApiKeyListSchema,
        ),
        post: scopedWrite({
          summary: "Mint an end-user API key (plaintext returned once)",
          permission: "userkey:create",
          input: CreateUserApiKeyInput,
          success: { code: "201", schema: UserApiKeyCreatedSchema },
        }),
      },
      "/api/v1/apps/{app}/user-keys/validate": {
        post: scopedWrite({
          summary: "Validate a presented end-user key (200 + valid discriminator)",
          permission: "userkey:validate",
          input: ValidateUserApiKeyInput,
          success: { code: "200", schema: UserApiKeyValidationSchema },
        }),
      },
      "/api/v1/apps/{app}/user-keys/{id}": {
        delete: scopedWrite({
          summary: "Revoke an end-user API key (idempotent)",
          permission: "userkey:revoke",
          success: { code: "200", schema: OkSchema },
          extraParams: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        }),
      },
      "/api/v1/apps/{app}/audit": {
        get: scopedGet("List recent audit entries", "audit:read", AuditListSchema),
      },
    },
  }
  return Response.json(doc)
}
