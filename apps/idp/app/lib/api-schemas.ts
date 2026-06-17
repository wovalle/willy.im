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
