import * as schema from "../../app/db/schema"
import type { BaseServiceContext } from "../../app/lib/services"

/**
 * Row builders for the tables the service layer reads. Deliberately thin — they
 * insert exactly what production inserts, so tests exercise the real shapes.
 */

let counter = 0
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`

export async function createUser(
  ctx: BaseServiceContext,
  input: { email: string; name?: string; id?: string },
) {
  const id = input.id ?? `user_${uniq()}`
  await ctx.db.insert(schema.user).values({
    id,
    name: input.name ?? input.email,
    email: input.email.trim().toLowerCase(),
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { id, email: input.email.trim().toLowerCase() }
}

/**
 * Registers an OAuth client tagged with `metadata.app` — the application key
 * everything else (members, workspaces, keys, claims) is scoped by.
 */
export async function createApplication(
  ctx: BaseServiceContext,
  input: {
    app: string
    name?: string
    allowSignup?: boolean
    /** The app's declared product-permission catalog. */
    permissions?: string[]
    redirectUris?: string[]
  },
) {
  const clientId = `client_${input.app}_${uniq()}`
  await ctx.db.insert(schema.oauthClient).values({
    id: `oc_${uniq()}`,
    clientId,
    name: input.name ?? input.app,
    redirectUris: input.redirectUris ?? [`https://${input.app}.test/callback`],
    metadata: {
      app: input.app,
      allow_signup: input.allowSignup ?? false,
      permissions: input.permissions ?? [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { clientId, app: input.app }
}

export async function createMember(
  ctx: BaseServiceContext,
  input: {
    app: string
    userId: string
    role: "admin" | "member"
    permissions?: string[]
    productPermissions?: string[]
  },
) {
  await ctx.db.insert(schema.applicationMember).values({
    applicationId: input.app,
    userId: input.userId,
    role: input.role,
    permissions: input.permissions ?? [],
    productPermissions: input.productPermissions ?? [],
  })
}

/** A workspace (organization) belonging to one application. */
export async function createWorkspace(
  ctx: BaseServiceContext,
  input: { app: string; slug: string; name?: string },
) {
  const id = `org_${uniq()}`
  await ctx.db.insert(schema.organization).values({
    id,
    name: input.name ?? input.slug,
    slug: input.slug,
    applicationId: input.app,
    createdAt: new Date(),
  })
  return { id, slug: input.slug }
}

export async function addWorkspaceMember(
  ctx: BaseServiceContext,
  input: { organizationId: string; userId: string; role?: string },
) {
  await ctx.db.insert(schema.member).values({
    id: `mem_${uniq()}`,
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role ?? "member",
    createdAt: new Date(),
  })
}

/** A live session row — what `actClaimFor` reads to detect impersonation. */
export async function createSession(
  ctx: BaseServiceContext,
  input: { userId: string; impersonatedBy?: string | null; expiresAt?: Date },
) {
  const id = `sess_${uniq()}`
  await ctx.db.insert(schema.session).values({
    id,
    token: `tok_${uniq()}`,
    userId: input.userId,
    impersonatedBy: input.impersonatedBy ?? null,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { id }
}

/** A Request carrying a bearer token, for the management-API gates. */
export function bearerRequest(token: string, url = "https://idp.willy.im/api/v1/apps") {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } })
}
