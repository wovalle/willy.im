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
