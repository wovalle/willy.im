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
  AdminKeyCreatedSchema,
  AdminKeyListSchema,
  ApiKeyCreatedSchema,
  ApiKeyListSchema,
  ApplicationCreatedSchema,
  ApplicationListSchema,
  ApplicationSchema,
  AppPermissionsSchema,
  AuditListSchema,
  ClientSecretSchema,
  CreateAdminKeyInput,
  CreateApiKeyInput,
  CreateApplicationInput,
  CreateUserApiKeyInput,
  CreateWorkspaceInput,
  InviteMemberInput,
  InviteMemberResult,
  MemberListSchema,
  OkSchema,
  SetAppPermissionsInput,
  UpdateApplicationInput,
  UpdateMemberInput,
  UserApiKeyCreatedSchema,
  UserApiKeyListSchema,
  UserApiKeyValidationSchema,
  LinkedIdentityListSchema,
  LinkIdentityInput,
  LinkedIdentityCreatedSchema,
  IdentityResolutionSchema,
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
  /** Set when the operation addresses a single row that may not exist. */
  notFound?: string
  input?: z.ZodType
  successCode: "200" | "201"
  success: z.ZodType
}

const APP_PARAM = { app: "Application key (oauth_client.metadata.app)." } as const
const CLIENT_PARAM = { clientId: "OAuth client id of the application." } as const

export const operations = {
  "get /api/v1/applications": {
    summary: "List registered applications",
    successCode: "200",
    success: ApplicationListSchema,
  },
  "post /api/v1/applications": {
    summary: "Register an application (client secret returned once)",
    description:
      "Requires an admin key. Creating an application is an IdP-level act — there is no app to scope a permission to yet.",
    input: CreateApplicationInput,
    successCode: "201",
    success: ApplicationCreatedSchema,
  },
  "get /api/v1/applications/{clientId}": {
    summary: "Get one application",
    permission: "app:read",
    params: CLIENT_PARAM,
    notFound: "No application with that client id",
    successCode: "200",
    success: ApplicationSchema,
  },
  "patch /api/v1/applications/{clientId}": {
    summary: "Update an application",
    permission: "app:update",
    params: CLIENT_PARAM,
    notFound: "No application with that client id",
    input: UpdateApplicationInput,
    successCode: "200",
    success: ApplicationSchema,
  },
  "delete /api/v1/applications/{clientId}": {
    summary: "Deregister an application",
    permission: "app:delete",
    params: CLIENT_PARAM,
    notFound: "No application with that client id",
    successCode: "200",
    success: OkSchema,
  },
  "post /api/v1/applications/{clientId}/rotate-secret": {
    summary: "Rotate the client secret (returned once; the old one stops working)",
    permission: "app:update",
    params: CLIENT_PARAM,
    notFound: "No application with that client id",
    successCode: "200",
    success: ClientSecretSchema,
  },
  "put /api/v1/apps/{app}/permissions": {
    summary: "Replace the app's product-permission catalog",
    permission: "app:update",
    params: APP_PARAM,
    notFound: "No application with that app key",
    input: SetAppPermissionsInput,
    successCode: "200",
    success: AppPermissionsSchema,
  },
  "get /api/v1/apps/{app}/keys": {
    summary: "List scoped management API keys (never the hashes)",
    permission: "apikey:read",
    params: APP_PARAM,
    successCode: "200",
    success: ApiKeyListSchema,
  },
  "post /api/v1/apps/{app}/keys": {
    summary: "Mint a scoped management API key (plaintext returned once)",
    description:
      "Requires `apikey:create` on the path app (or an admin key). The requested permissions must be a subset of the caller's own, otherwise 403 `permissions_exceed_caller` — without that rule any key holding `apikey:create` could mint itself a more powerful successor.",
    permission: "apikey:create",
    params: APP_PARAM,
    input: CreateApiKeyInput,
    successCode: "201",
    success: ApiKeyCreatedSchema,
  },
  "delete /api/v1/apps/{app}/keys/{id}": {
    summary: "Revoke a scoped management API key (idempotent)",
    permission: "apikey:revoke",
    params: APP_PARAM,
    notFound: "No key with that id on this app",
    successCode: "200",
    success: OkSchema,
  },
  "get /api/v1/admin-keys": {
    summary: "List IdP-level admin keys (never the hashes)",
    description:
      "Requires an admin key. Admin keys are `api_key` rows with no application scope, so they hold every permission on every app.",
    successCode: "200",
    success: AdminKeyListSchema,
  },
  "post /api/v1/admin-keys": {
    summary: "Mint an IdP-level admin key (plaintext returned once)",
    description:
      "Requires an admin key. Mint one per agent: an admin key has a name, an optional expiry, a revoke switch, and its own `adminkey:<id>` identity in the audit log, so every superadmin action is attributable.",
    input: CreateAdminKeyInput,
    successCode: "201",
    success: AdminKeyCreatedSchema,
  },
  "delete /api/v1/admin-keys/{id}": {
    summary: "Revoke an IdP-level admin key (idempotent)",
    description:
      "A key may revoke itself — an agent cleaning up after itself is legitimate — after which its next request is simply unauthorized.",
    params: { id: "Admin key id." },
    notFound: "No admin key with that id",
    successCode: "200",
    success: OkSchema,
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

  "get /api/v1/users/{userId}/identities": {
    summary: "List a user's linked identities (their ids on other systems)",
    description:
      "Requires an admin key. Identities are global to the user, not per app — a Slack id identifies a person regardless of who is asking.",
    params: { userId: "IdP user id." },
    successCode: "200",
    success: LinkedIdentityListSchema,
  },
  "post /api/v1/users/{userId}/identities": {
    summary: "Link an external id to a user",
    description:
      "Requires an admin key: a link asserts identity with nothing to prove it, so no app or member may do it. 201 on a new link, 200 when the same pair was already this user's, 409 `already_linked` when it belongs to someone else — an identity is never silently re-pointed.",
    params: { userId: "IdP user id." },
    input: LinkIdentityInput,
    successCode: "201",
    success: LinkedIdentityCreatedSchema,
  },
  "delete /api/v1/users/{userId}/identities/{id}": {
    summary: "Unlink an external id (idempotent)",
    description: "Requires an admin key.",
    params: { userId: "IdP user id.", id: "Linked identity id." },
    successCode: "200",
    success: OkSchema,
  },
  "get /api/v1/apps/{app}/identities/{provider}/{externalId}": {
    summary: "Resolve an external id to a user and their permissions in this app",
    description:
      "The hot path for an app that hears from someone on another system. Always 200 with a `found` discriminator — a miss is data, and the common case in any shared channel. `permissions` are the user's product permissions for THIS app, computed exactly as the claims hook computes them at token mint, so a Slack message and a browser session from the same person carry the same grants. A user with no membership resolves as found with no permissions.",
    permission: "identity:resolve",
    params: { ...APP_PARAM, provider: "The other system, e.g. slack.", externalId: "The id as that system spells it." },
    successCode: "200",
    success: IdentityResolutionSchema,
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
