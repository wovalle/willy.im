import { desc, eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { parseAppMetadata, type ResourceTypeDecl, unwrapJson as unwrap } from "./metadata"
import type { AppCatalog } from "./scopes.server"
import type { BaseServiceContext } from "./services"

function coerceUriList(v: unknown): string[] {
  const x = unwrap(v)
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []
}

export type ApplicationSummary = {
  clientId: string
  name: string | null
  app: string | null
  allowSignup: boolean
  permissions: string[]
  /** Declared resource types — permission families over instances the app holds. */
  resourceTypes: ResourceTypeDecl[]
  /** Protected resource URIs (e.g. the app's MCP server) — valid `resource` audiences. */
  resources: string[]
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

  return rows.map((r) => {
    const meta = parseAppMetadata(unwrap(r.metadata))
    return {
      clientId: r.clientId,
      name: r.name,
      app: meta.app,
      allowSignup: meta.allow_signup,
      permissions: meta.permissions,
      resourceTypes: meta.resource_types,
      resources: meta.resources,
      redirectUris: coerceUriList(r.redirectUris),
      disabled: !!r.disabled,
      createdAt: r.createdAt ?? new Date(0),
    }
  })
}

export async function getApplication(
  ctx: BaseServiceContext,
  clientId: string,
): Promise<ApplicationSummary | null> {
  const all = await listApplications(ctx)
  return all.find((a) => a.clientId === clientId) ?? null
}

/** The app key an OAuth client is tagged with, or null for an unknown or untagged client. */
export async function appKeyOf(ctx: BaseServiceContext, clientId: string): Promise<string | null> {
  return (await getApplication(ctx, clientId))?.app ?? null
}

/** Find an application by its app key (oauth_client.metadata.app). */
export async function getApplicationByApp(
  ctx: BaseServiceContext,
  app: string,
): Promise<ApplicationSummary | null> {
  const all = await listApplications(ctx)
  return all.find((a) => a.app === app) ?? null
}

/** The two halves of an app's product catalog, as the scope checks read them. */
export function catalogOf(application: ApplicationSummary | null | undefined): AppCatalog {
  return {
    permissions: application?.permissions ?? [],
    resourceTypes: application?.resourceTypes ?? [],
  }
}
