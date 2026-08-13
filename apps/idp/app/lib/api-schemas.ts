import { z } from "zod"

export const ApplicationSchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  app: z.string().nullable().describe("Application key; consumer workspace claims are filtered by this"),
  redirectUris: z.array(z.string()),
  disabled: z.boolean(),
  createdAt: z.string().describe("ISO 8601 timestamp"),
})

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
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
})
export const InviteMemberResult = z.object({
  // "added" = existing user joined now; "invited" = pending invite emailed.
  result: z.enum(["added", "invited"]),
})

export const UpdateMemberInput = z.object({
  role: RoleSchema,
  permissions: z.array(z.string()).default([]),
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
  scopes: z.array(z.string()).default([]).describe("Subset of the app's product permission catalog"),
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
