import { desc, eq } from "drizzle-orm"
import { redirect } from "react-router"

import * as schema from "../db/schema"
import type { AuthService } from "./auth.server"
import type { BaseServiceContext } from "./services"

function adminEmails(ctx: BaseServiceContext): string[] {
  return ctx
    .getAppEnv("ADMIN_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(ctx: BaseServiceContext, email?: string | null) {
  return !!email && adminEmails(ctx).includes(email.toLowerCase())
}

/** UI gate: require a signed-in admin session, else redirect / 403. */
export async function requireAdminSession(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
) {
  const session = await auth.api.getSession({ headers: request.headers })
  const admin = isAdminEmail(ctx, session?.user.email)
  ctx.logger.info("admin.gate", {
    hasSession: !!session,
    email: session?.user.email,
    admin,
  })
  if (!session) throw redirect("/login")
  if (!admin) {
    throw new Response("Forbidden", { status: 403 })
  }
  return session
}

/** API gate: require the management API bearer token. */
export function requireAdminToken(request: Request, ctx: BaseServiceContext) {
  const expected = ctx.getAppEnv("ADMIN_API_TOKEN")
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!expected || !provided || provided !== expected) {
    throw Response.json({ error: "unauthorized" }, { status: 401 })
  }
}

/**
 * better-auth and drizzle's mode:"json" columns don't always agree on
 * serialization (values can come back already-parsed, once-, or twice-encoded),
 * so unwrap defensively up to two JSON layers.
 */
function unwrap(v: unknown): unknown {
  let x = v
  for (let i = 0; i < 2 && typeof x === "string"; i++) {
    try {
      x = JSON.parse(x)
    } catch {
      break
    }
  }
  return x
}

function coerceUriList(v: unknown): string[] {
  const x = unwrap(v)
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []
}

function coerceApp(v: unknown): string | null {
  const x = unwrap(v)
  return x && typeof x === "object" && typeof (x as { app?: unknown }).app === "string"
    ? (x as { app: string }).app
    : null
}

export type ApplicationSummary = {
  clientId: string
  name: string | null
  app: string | null
  redirectUris: string[]
  disabled: boolean
  createdAt: Date
}

export async function listApplications(ctx: BaseServiceContext): Promise<ApplicationSummary[]> {
  const rows = await ctx.db
    .select({
      clientId: schema.oauthClient.clientId,
      name: schema.oauthClient.name,
      metadata: schema.oauthClient.metadata,
      redirectUris: schema.oauthClient.redirectUris,
      disabled: schema.oauthClient.disabled,
      createdAt: schema.oauthClient.createdAt,
    })
    .from(schema.oauthClient)
    .orderBy(desc(schema.oauthClient.createdAt))

  return rows.map((r) => ({
    clientId: r.clientId,
    name: r.name,
    app: coerceApp(r.metadata),
    redirectUris: coerceUriList(r.redirectUris),
    disabled: !!r.disabled,
    createdAt: r.createdAt ?? new Date(0),
  }))
}

/**
 * Registers an OAuth client and tags it with metadata.app (the application key
 * consumers' workspace claims are filtered by). Creation goes through better-auth
 * (which hashes the secret and requires the admin's session), then we set the
 * app tag with a direct update.
 */
export async function createApplication(
  request: Request,
  ctx: BaseServiceContext,
  auth: AuthService,
  input: { name: string; redirectUris: string[]; app: string },
) {
  const created = (await auth.api.createOAuthClient({
    headers: request.headers,
    body: { client_name: input.name, redirect_uris: input.redirectUris },
  })) as { client_id: string; client_secret: string }

  await ctx.db
    .update(schema.oauthClient)
    // mode:"json" column — pass the object; drizzle serializes it.
    .set({ metadata: { app: input.app } })
    .where(eq(schema.oauthClient.clientId, created.client_id))

  return { clientId: created.client_id, clientSecret: created.client_secret }
}

/**
 * Generates a new client secret and replaces the stored hash. The old secret
 * stops working immediately. The new plaintext is returned once.
 */
export async function rotateApplicationSecret(
  request: Request,
  auth: AuthService,
  clientId: string,
) {
  const res = (await auth.api.rotateClientSecret({
    headers: request.headers,
    body: { client_id: clientId },
  })) as { client_secret?: string; clientSecret?: string }
  return { clientId, clientSecret: res.client_secret ?? res.clientSecret ?? "" }
}

export async function deleteApplication(ctx: BaseServiceContext, clientId: string) {
  await ctx.db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, clientId))
}

export async function listUsers(ctx: BaseServiceContext) {
  return ctx.db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt))
}

export async function listWorkspaces(ctx: BaseServiceContext) {
  return ctx.db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      applicationId: schema.organization.applicationId,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .orderBy(desc(schema.organization.createdAt))
}

export async function createWorkspace(
  request: Request,
  auth: AuthService,
  input: { name: string; slug: string; applicationId: string },
) {
  return auth.api.createOrganization({
    headers: request.headers,
    body: { name: input.name, slug: input.slug, applicationId: input.applicationId },
  })
}
