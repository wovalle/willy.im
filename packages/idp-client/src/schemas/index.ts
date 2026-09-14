/**
 * The wire shapes of the IdP management API (`/api/v1/*`), as zod schemas.
 *
 * One definition, three consumers: `apps/idp` validates incoming requests with
 * them, `scripts/generate-openapi.mjs` turns them into the OpenAPI document,
 * and the SDK's `api.ts` parses responses against them. Types are `z.infer`,
 * so there is no generated `.d.ts` to drift out of sync.
 *
 * The OIDC endpoints are NOT here — those are standards-defined and live in
 * `../wire.ts`, next to the code that talks to them.
 */

import { z } from "zod"

// --- Resource-scoped permissions ---
//
// A permission names a surface (`kirby:read`). A resource TYPE names a family
// of permissions over instances the app holds (`kirby:thread` over every
// conversation), and a grant is the composed string `<type>:<id>` —
// `kirby:thread:t_7f3a`. The IdP never stores the instances: it asks the app
// for them, over the `list` URL the type declares, whenever a human picks one
// or a key is minted. `grants()` is untouched — `kirby:*` and `*` cover every
// instance the same way they cover `kirby:read`.

/** A resource type name: colon-separated lowercase segments, no wildcard. */
export const RESOURCE_TYPE_RE = /^[a-z0-9_-]+(:[a-z0-9_-]+)*$/
/** An instance id: the final segment of a grant, so no colon, no `*`, no whitespace. */
export const RESOURCE_ID_RE = /^[^\s:*]+$/

/**
 * The permission the IdP's listing token carries, so an app can gate its `list`
 * endpoint with `resourceServer.authenticate(request, { permissions: [...] })`.
 * Namespaced under `idp:` so it can never collide with an app's own catalog.
 */
export const RESOURCE_LIST_PERMISSION = "idp:resources:list"

/** Lifetime of the IdP-signed token that authenticates a listing call. */
export const RESOURCE_LIST_TOKEN_TTL_S = 60

export const ResourceTypeInput = z.object({
  type: z
    .string()
    .regex(RESOURCE_TYPE_RE, "lowercase segments separated by colons, e.g. kirby:thread")
    .describe("Permission prefix a grant composes under: `kirby:thread` → `kirby:thread:<id>`"),
  label: z.string().min(1).optional().describe("Human name for one instance, shown in the console — “WhatsApp conversation”"),
  list: z
    .string()
    .url()
    .describe(
      "Absolute URL the IdP GETs to enumerate instances. Called with an IdP-signed bearer JWT (aud = this URL); must answer `ResourceListSchema`",
    ),
})
export const ResourceTypeSchema = z.object({
  type: z.string(),
  label: z.string(),
  list: z.string(),
})

/** One instance of a resource type, as the app's `list` endpoint reports it. */
export const ResourceInstanceSchema = z.object({
  id: z.string().regex(RESOURCE_ID_RE).describe("The stable, opaque id the grant will name — a handle, never an alias"),
  label: z.string().min(1).describe("What a human sees when picking it"),
  description: z.string().nullable().optional().describe("Secondary line in the picker — kind, size, last activity"),
})
/** The body an app's resource `list` endpoint must answer with. */
export const ResourceListSchema = z.object({ resources: z.array(ResourceInstanceSchema) })

export const ApplicationSchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  app: z.string().nullable().describe("Application key; consumer workspace claims are filtered by this"),
  allowSignup: z.boolean().describe("Whether unknown users may sign themselves up"),
  permissions: z.array(z.string()).describe("The app's declared product-permission catalog"),
  resourceTypes: z
    .array(ResourceTypeSchema)
    .describe("Declared resource types — permission families over instances the app holds"),
  resources: z
    .array(z.string())
    .describe("Protected resource URIs (e.g. the app's MCP server) — valid `resource` audiences for access tokens"),
  redirectUris: z.array(z.string()),
  disabled: z.boolean(),
  createdAt: z.string().describe("ISO 8601 timestamp"),
})

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z
    .string()
    .describe("Avatar URL — the user's own picture, or the blobatar the IdP renders for them"),
  emailVerified: z.boolean(),
  createdAt: z.string(),
})

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  applicationId: z.string().nullable(),
  createdAt: z.string(),
})

export const ApplicationListSchema = z.object({ applications: z.array(ApplicationSchema) })

/**
 * Register an application. Superadmin only — there is no app to scope it to
 * yet, so no per-app permission could authorize it.
 */
export const CreateApplicationInput = z.object({
  name: z.string().min(1),
  app: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, numbers and dashes only")
    .describe("Stable application key — the join key for members, workspaces and keys"),
  redirectUris: z.array(z.string().min(1)).min(1),
  firstAdminUserId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Who becomes the app's first IdP admin. Defaults to the calling user; null leaves the app with no members (superadmin-managed).",
    ),
})
export const ApplicationCreatedSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().describe("Plaintext client secret — shown exactly once, never stored"),
  app: z.string(),
})

/** Partial update of an application. Omitted fields are left alone. */
export const UpdateApplicationInput = z.object({
  name: z.string().min(1).optional(),
  redirectUris: z.array(z.string().min(1)).min(1).optional(),
  allowSignup: z.boolean().optional(),
  resources: z
    .array(z.string().url())
    .optional()
    .describe("Replace the app's protected resource URIs — absolute https, no fragment"),
})

export const ClientSecretSchema = z.object({
  clientSecret: z.string().describe("Plaintext client secret — shown exactly once, never stored"),
})

/**
 * Replaces the app's product-permission catalog wholesale — both the flat
 * permissions and the resource types. Omitting `resourceTypes` clears them,
 * the same way omitting a permission removes it.
 */
export const SetAppPermissionsInput = z.object({
  permissions: z.array(z.string().min(1)),
  resourceTypes: z.array(ResourceTypeInput).default([]),
})
export const AppPermissionsSchema = z.object({
  permissions: z.array(z.string()),
  resourceTypes: z.array(ResourceTypeSchema),
})
export const UserListSchema = z.object({ users: z.array(UserSchema) })
export const WorkspaceListSchema = z.object({ workspaces: z.array(WorkspaceSchema) })

// --- Write management API (scoped-key authenticated, per-app) ---

export const RoleSchema = z.enum(["admin", "member"])

export const MemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: RoleSchema,
  permissions: z.array(z.string()),
})
export const MemberListSchema = z.object({ members: z.array(MemberSchema) })

/** Add (existing user) or invite (new email) an app member. */
export const InviteMemberInput = z.object({
  email: z.string().email(),
  role: RoleSchema.default("member"),
  permissions: z.array(z.string()).default([]),
  /**
   * Grants from the APP's catalog — `chat:respond`, `kirby_runs`,
   * `kirby:thread:t_14f451b6`. Distinct from `permissions` above, which are the
   * IdP's own management verbs. Without this an API-provisioned member is inert
   * until a human opens the console, which is the opposite of what a management
   * API is for.
   */
  productPermissions: z.array(z.string()).default([]),
})
export const InviteMemberResult = z.object({
  // "added" = existing user joined now; "invited" = pending invite emailed.
  result: z.enum(["added", "invited"]),
})

export const UpdateMemberInput = z.object({
  role: RoleSchema,
  permissions: z.array(z.string()).default([]),
  /**
   * The member's product grants, REPLACED wholesale — same verb the console
   * uses, because a merge would make "take this away" impossible to express.
   * Omit the field to leave the existing grants untouched.
   */
  productPermissions: z.array(z.string()).optional(),
})

export const CreateWorkspaceInput = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and dashes only"),
})
export const WorkspaceCreatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

export const OkSchema = z.object({ ok: z.literal(true) })

// --- End-user API keys (the app's own API credentials, stored in the IdP) ---

export const UserApiKeySchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  name: z.string(),
  prefix: z.string().describe("Non-secret token prefix (wak_…) for display"),
  scopes: z.array(z.string()),
  status: z.enum(["active", "expired", "revoked"]),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
})
export const UserApiKeyListSchema = z.object({ keys: z.array(UserApiKeySchema) })

export const CreateUserApiKeyInput = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  scopes: z
    .array(z.string())
    .default([])
    .describe(
      "Declared permissions, or `<type>:<id>` grants over a declared resource type whose instance the app currently lists",
    ),
  workspaceId: z.string().optional(),
  expiresAt: z.iso.datetime().optional().describe("ISO 8601; omit for non-expiring"),
})
export const UserApiKeyCreatedSchema = z.object({
  id: z.string(),
  token: z.string().describe("Plaintext key — shown exactly once, never stored"),
  prefix: z.string(),
})

export const ValidateUserApiKeyInput = z.object({ token: z.string().min(1) })
export const UserApiKeyValidationSchema = z.union([
  z.object({
    valid: z.literal(true),
    keyId: z.string(),
    userId: z.string(),
    workspaceId: z.string().nullable(),
    scopes: z.array(z.string()),
    name: z.string(),
  }),
  z.object({ valid: z.literal(false), reason: z.enum(["not_found", "revoked", "expired"]) }),
])

// --- Linked identities (a user's ids on other systems) ---

export const LinkedIdentitySchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.string().describe("The other system, lowercase — slack, whatsapp, telegram"),
  externalId: z.string().describe("The id exactly as that system spells it"),
  label: z.string().nullable(),
  createdAt: z.string(),
})
export const LinkedIdentityListSchema = z.object({ identities: z.array(LinkedIdentitySchema) })

export const LinkIdentityInput = z.object({
  provider: z.string().min(1).describe("slack, whatsapp, telegram… — normalised to lowercase"),
  externalId: z.string().min(1).describe("The id as that system spells it, e.g. a Slack member id"),
  label: z.string().optional().describe("A human label for the console"),
})
export const LinkedIdentityCreatedSchema = z.object({
  id: z.string(),
  created: z.boolean().describe("false when the same pair was already this user's"),
})

export const IdentityResolutionSchema = z.union([
  z.object({
    found: z.literal(true),
    userId: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    permissions: z
      .array(z.string())
      .describe("The user's product permissions for the asking app; admins get the whole catalog"),
  }),
  z.object({ found: z.literal(false) }),
])

export const AuditEntrySchema = z.object({
  id: z.number(),
  tableName: z.string(),
  operation: z.string(),
  rowId: z.string().nullable(),
  userId: z.string().nullable(),
  actor: z.string().nullable(),
  createdAt: z.string(),
})
export const AuditListSchema = z.object({ entries: z.array(AuditEntrySchema) })

// --- Scoped management API keys (drive this API for one app) ---

export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string().describe("Non-secret token prefix (wim_…) for display"),
  permissions: z.array(z.string()).describe("IdP management permissions this key holds"),
  status: z.enum(["active", "expired", "revoked"]),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
})
export const ApiKeyListSchema = z.object({ keys: z.array(ApiKeySchema) })

export const CreateApiKeyInput = z.object({
  name: z.string().min(1),
  permissions: z
    .array(z.string().min(1))
    .describe("IdP management permissions; must be a subset of the caller's own on this app"),
  expiresAt: z.iso.datetime().optional().describe("ISO 8601; omit for non-expiring"),
})
export const ApiKeyCreatedSchema = z.object({
  id: z.string(),
  token: z.string().describe("Plaintext key — shown exactly once, never stored"),
  prefix: z.string(),
})

// --- IdP-level admin keys (superadmin over every app) ---

export const AdminKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string().describe("Non-secret token prefix (wim_…) for display"),
  status: z.enum(["active", "expired", "revoked"]),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
})
export const AdminKeyListSchema = z.object({ keys: z.array(AdminKeySchema) })

export const CreateAdminKeyInput = z.object({
  name: z.string().min(1).describe("Who holds it — one key per agent, so the audit log reads"),
  expiresAt: z.iso.datetime().optional().describe("ISO 8601; omit for non-expiring"),
})
export const AdminKeyCreatedSchema = z.object({
  id: z.string(),
  token: z.string().describe("Plaintext key — shown exactly once, never stored"),
  prefix: z.string(),
})
