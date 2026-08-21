/**
 * Every operation the management API exposes, in one table.
 *
 * Three things read it: `buildOpenApiDocument` (in `./openapi.ts`) turns it
 * into the published document, `api.ts` uses it to type its `request()` and to
 * parse what comes back, and `apps/idp` validates request bodies with the same
 * `input` schemas. Adding an endpoint means adding a row here; nothing else
 * needs to learn about it.
 */

import { z } from "zod"

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
} from "./index.js"

export type HttpMethod = "get" | "post" | "patch" | "delete" | "put"

/** A query parameter, as the document describes it. Path params are inferred. */
export type QueryParam = { name: string; description?: string; required?: boolean }

export type OperationDef = {
  summary: string
  /**
   * The scoped-key permission this operation needs. Absent means superadmin
   * only — the cross-app list endpoints.
   */
  permission?: string
  description?: string
  query?: readonly QueryParam[]
  /** Path-parameter descriptions, keyed by name. Purely documentation. */
  params?: Readonly<Record<string, string>>
  input?: z.ZodType
  successCode: "200" | "201"
  success: z.ZodType
}

const APP_PARAM = { app: "Application key (oauth_client.metadata.app)." } as const

export const operations = {
  "get /api/v1/applications": {
    summary: "List registered applications",
    successCode: "200",
    success: ApplicationListSchema,
  },
  "get /api/v1/users": {
    summary: "List users",
    successCode: "200",
    success: UserListSchema,
  },
  "get /api/v1/workspaces": {
    summary: "List workspaces",
    successCode: "200",
    success: WorkspaceListSchema,
  },

  "get /api/v1/apps/{app}/members": {
    summary: "List app members",
    permission: "member:read",
    params: APP_PARAM,
    successCode: "200",
    success: MemberListSchema,
  },
  "post /api/v1/apps/{app}/members": {
    summary: "Add or invite a member",
    permission: "member:invite",
    params: APP_PARAM,
    input: InviteMemberInput,
    successCode: "201",
    success: InviteMemberResult,
  },
  "patch /api/v1/apps/{app}/members/{userId}": {
    summary: "Update a member's role + permissions",
    permission: "member:manage",
    params: APP_PARAM,
    input: UpdateMemberInput,
    successCode: "200",
    success: OkSchema,
  },
  "delete /api/v1/apps/{app}/members/{userId}": {
    summary: "Remove a member",
    permission: "member:manage",
    params: APP_PARAM,
    successCode: "200",
    success: OkSchema,
  },

  "get /api/v1/apps/{app}/workspaces": {
    summary: "List app workspaces",
    permission: "workspace:read",
    params: APP_PARAM,
    successCode: "200",
    success: WorkspaceListSchema,
  },
  "post /api/v1/apps/{app}/workspaces": {
    summary: "Create a workspace",
    permission: "workspace:create",
    params: APP_PARAM,
    input: CreateWorkspaceInput,
    successCode: "201",
    success: WorkspaceCreatedSchema,
  },

  "get /api/v1/apps/{app}/user-keys": {
    summary: "List end-user API keys",
    permission: "userkey:read",
    params: APP_PARAM,
    query: [
      { name: "userId", description: "Only keys owned by this user." },
      { name: "workspaceId", description: "Only keys bound to this workspace." },
    ],
    successCode: "200",
    success: UserApiKeyListSchema,
  },
  "post /api/v1/apps/{app}/user-keys": {
    summary: "Mint an end-user API key (plaintext returned once)",
    permission: "userkey:create",
    params: APP_PARAM,
    input: CreateUserApiKeyInput,
    successCode: "201",
    success: UserApiKeyCreatedSchema,
  },
  "post /api/v1/apps/{app}/user-keys/validate": {
    summary: "Validate a presented end-user key (200 + valid discriminator)",
    permission: "userkey:validate",
    params: APP_PARAM,
    input: ValidateUserApiKeyInput,
    successCode: "200",
    success: UserApiKeyValidationSchema,
  },
  "delete /api/v1/apps/{app}/user-keys/{id}": {
    summary: "Revoke an end-user API key (idempotent)",
    permission: "userkey:revoke",
    params: APP_PARAM,
    successCode: "200",
    success: OkSchema,
  },

  "get /api/v1/apps/{app}/audit": {
    summary: "List recent audit entries",
    permission: "audit:read",
    params: APP_PARAM,
    successCode: "200",
    success: AuditListSchema,
  },
} as const satisfies Record<string, OperationDef>

export type Operations = typeof operations
export type OperationKey = keyof Operations

/** `"get /api/v1/users"` -> the paths that declare that method. */
export type PathsFor<M extends HttpMethod> = OperationKey extends infer K
  ? K extends `${M} ${infer P}`
    ? P
    : never
  : never

export type OperationFor<M extends HttpMethod, P extends string> = `${M} ${P}` extends OperationKey
  ? Operations[`${M} ${P}`]
  : never

/** Path parameters read straight off the path template — `{app}`, `{userId}`. */
export type PathParamNames<P extends string> = P extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PathParamNames<Rest>
  : never

export function lookup(method: string, path: string): OperationDef | undefined {
  return (operations as Record<string, OperationDef>)[`${method.toLowerCase()} ${path}`]
}
