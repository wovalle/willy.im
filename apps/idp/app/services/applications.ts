import { declareService, fail, method } from "@willyim/kit"
import { eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { getApplicationByApp, listApplications, type ApplicationSummary } from "../lib/admin.server"
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
} from "../lib/client-secret.server"
import { serializeAppMetadata, type AppMetadata, type ResourceTypeDecl } from "../lib/metadata"
import { firstInvalidRedirectUri } from "../lib/validate"
import { io } from "./io"

/**
 * Applications: the OAuth clients the IdP signs people in to, each tagged with
 * its app key (`metadata.app`), the tenant every other service is scoped by.
 * Registering and listing them is IdP-level (superadmin); everything else runs
 * inside the app and needs that app's `app:*` permission.
 */

const toApplication = (a: ApplicationSummary) => ({ ...a, createdAt: a.createdAt.toISOString() })

/** The registration's metadata, as stored: what a write changes one part of. */
const metadataOf = (a: ApplicationSummary): AppMetadata => ({
  app: a.app,
  allow_signup: a.allowSignup,
  permissions: a.permissions,
  resources: a.resources,
  resource_types: a.resourceTypes,
})

/** The app's registration; a 404 when its client is gone. */
const registration = async (ctx: Parameters<typeof getApplicationByApp>[0] & { app: string }) =>
  (await getApplicationByApp(ctx, ctx.app)) ?? fail(404, `No application ${ctx.app}.`)

/**
 * Of `wanted`, the resource URIs already declared by an application OTHER than
 * `selfApp`. A resource URI maps to exactly one owning app (claims.server
 * `appForResource`), so declaring one another app already holds is refused.
 */
async function resourcesOwnedByOtherApps(
  ctx: Parameters<typeof listApplications>[0],
  selfApp: string | null,
  wanted: string[],
): Promise<string[]> {
  const want = new Set(wanted)
  const taken = new Set<string>()
  for (const a of await listApplications(ctx)) {
    if (a.app === selfApp) continue
    for (const r of a.resources) if (want.has(r)) taken.add(r)
  }
  return [...taken]
}

/**
 * Of `wanted`, the resource-type list URLs already used by an application OTHER
 * than `selfApp`. The IdP mints a token whose `aud` is this URL and GETs it, so
 * a list URL must belong to the app that declares it and no other.
 */
async function listUrlsOwnedByOtherApps(
  ctx: Parameters<typeof listApplications>[0],
  selfApp: string | null,
  wanted: string[],
): Promise<string[]> {
  const want = new Set(wanted)
  const taken = new Set<string>()
  for (const a of await listApplications(ctx)) {
    if (a.app === selfApp) continue
    for (const t of a.resourceTypes) if (want.has(t.list)) taken.add(t.list)
  }
  return [...taken]
}

/**
 * A resource is an audience a token will be minted FOR, so it has to be an
 * absolute https URI with no fragment (RFC 8707 §2) — anything looser and a
 * token could be minted for a string no resource server will ever match.
 */
function isResourceUri(raw: string) {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && !url.hash
  } catch {
    return false
  }
}

/**
 * Is this somewhere the IdP may call out to? Production apps are https; the
 * loopback exception exists so a local bender can be granted against a local
 * IdP without a TLS setup neither will ever have.
 */
function isCallableListUrl(raw: string) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.hash) return false
  if (url.protocol === "https:") return true
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
}

const invalidRedirect = (uri: string) =>
  fail(422, `"${uri}" isn't a valid URL. Use an absolute URL like https://app.example.com/callback.`)

// What a person sees on the consent screen and in the console. The schema's
// min(1) lets "   " through; a registered app always has a real name.
const blankName = () => fail(422, "Give the application a name.")

export const applications = declareService((ctx) => {
  const current = () => registration(ctx)

  const byClientId = (clientId: string) => eq(schema.oauthClient.clientId, clientId)

  return {
    list: method(
      {
        summary: "List every registered application, newest first",
        permission: "*",
        hints: { readOnly: true },
        ...io("applications.list"),
      },
      async () => ({ applications: (await listApplications(ctx)).map(toApplication) }),
    ),

    register: method(
      {
        summary: "Register an application (its client secret is returned once)",
        description:
          "IdP-level: there is no app to scope a permission to yet. The app key is the join key for members, workspaces, keys and claims (409 when taken). `firstAdminUserId` defaults to the calling user; null leaves the app with no members (superadmin-managed).",
        permission: "*",
        ...io("applications.register"),
      },
      async (input) => {
        const app = input.app.trim().toLowerCase()
        const name = input.name.trim()
        if (!name) blankName()
        const invalid = firstInvalidRedirectUri(input.redirectUris)
        if (invalid) invalidRedirect(invalid)
        // The key lives inside a JSON column, hence the scan.
        if ((await listApplications(ctx)).some((a) => a.app === app))
          fail(409, `The app key "${app}" is already taken.`)

        const clientId = generateClientId()
        const clientSecret = generateClientSecret()
        const now = new Date()
        // Inserted directly rather than through the plugin's /oauth2/create-client,
        // which needs a browser session. The values replicate what it writes for
        // a confidential web client; the secret is hashed with the very hasher the
        // plugin is configured with (client-secret.server.ts).
        await ctx.db.insert(schema.oauthClient).values({
          id: crypto.randomUUID(),
          clientId,
          clientSecret: await hashClientSecret(clientSecret),
          name,
          redirectUris: input.redirectUris,
          // @willyim/idp posts credentials in the form body, and the plugin only
          // accepts them the way the client registered.
          tokenEndpointAuthMethod: "client_secret_post",
          // The SDK refreshes with grant_type=refresh_token; declare it so a plugin
          // version that enforces grants per client doesn't break new apps only.
          grantTypes: ["authorization_code", "refresh_token"],
          responseTypes: ["code"],
          applicationType: "web",
          disabled: false,
          skipConsent: false,
          requirePKCE: true,
          scopes: null,
          userId: ctx.userId,
          metadata: { app },
          createdAt: now,
          updatedAt: now,
        })

        const firstAdminUserId =
          input.firstAdminUserId === undefined ? ctx.userId : input.firstAdminUserId
        if (firstAdminUserId)
          await ctx.db
            .insert(schema.applicationMember)
            .values({ applicationId: app, userId: firstAdminUserId, role: "admin" })
            .onConflictDoNothing()

        await ctx.audit.record({
          app,
          table: "oauth_client",
          operation: "create",
          rowId: clientId,
          after: { name, app, redirectUris: input.redirectUris, firstAdminUserId: firstAdminUserId ?? null },
        })
        return { clientId, clientSecret, app }
      },
    ),

    get: method(
      {
        summary: "Get this application's registration and declared catalog",
        permission: "app:read",
        hints: { readOnly: true },
        ...io("applications.get"),
      },
      async () => toApplication(await current()),
    ),

    update: method(
      {
        summary: "Update the app's name, redirect URIs, open signup or protected resources",
        description:
          "Omitted fields are left alone. `resources` are the app's protected resource URIs (its MCP server…), the valid `resource` audiences of its access tokens: absolute https, no fragment (422 otherwise).",
        permission: "app:update",
        hints: { idempotent: true },
        ...io("applications.update"),
      },
      async (patch) => {
        const app = await current()
        const name = patch.name?.trim()
        if (name === "") blankName()
        if (patch.redirectUris) {
          const invalid = firstInvalidRedirectUri(patch.redirectUris)
          if (invalid) invalidRedirect(invalid)
        }
        const resources = patch.resources?.map((r) => r.trim()).filter(Boolean)
        const badResource = resources?.find((r) => !isResourceUri(r))
        if (badResource) fail(422, `"${badResource}" isn't an absolute https URI without a fragment.`)

        // A resource URI is the audience of this app's access tokens, and
        // `appForResource` maps an audience back to exactly one owning app. If two
        // apps could declare the same URI, a token for it could be stamped with
        // the wrong app's permissions. So a resource already claimed by ANOTHER
        // app is refused here, at the only place it is written.
        if (resources?.length) {
          const taken = await resourcesOwnedByOtherApps(ctx, app.app, resources)
          if (taken.length)
            fail(409, `Already claimed by another application: ${taken.join(", ")}.`)
        }

        const metadataChanged = patch.allowSignup !== undefined || resources !== undefined
        await ctx.db
          .update(schema.oauthClient)
          .set({
            ...(name !== undefined && { name }),
            ...(patch.redirectUris !== undefined && { redirectUris: patch.redirectUris }),
            ...(metadataChanged && {
              metadata: serializeAppMetadata({
                ...metadataOf(app),
                allow_signup: patch.allowSignup ?? app.allowSignup,
                resources: resources ?? app.resources,
              }),
            }),
            updatedAt: new Date(),
          })
          .where(byClientId(app.clientId))
        await ctx.audit.record({
          table: "oauth_client",
          operation: "update",
          rowId: app.clientId,
          after: patch,
        })
        return toApplication(await current())
      },
    ),

    delete: method(
      {
        summary: "Deregister the application",
        permission: "app:delete",
        hints: { destructive: true },
        ...io("applications.delete"),
      },
      async () => {
        const { clientId } = await current()
        await ctx.db.delete(schema.oauthClient).where(byClientId(clientId))
        // Audited against the app key, so the trail survives the row it describes.
        await ctx.audit.record({ table: "oauth_client", operation: "delete", rowId: clientId })
        return { ok: true as const }
      },
    ),

    rotate_secret: method(
      {
        summary: "Rotate the app's client secret (the new one is returned once; the old one stops working)",
        permission: "app:update",
        hints: { destructive: true },
        ...io("applications.rotate_secret"),
      },
      async () => {
        const { clientId } = await current()
        const clientSecret = generateClientSecret()
        await ctx.db
          .update(schema.oauthClient)
          .set({ clientSecret: await hashClientSecret(clientSecret), updatedAt: new Date() })
          .where(byClientId(clientId))
        await ctx.audit.record({
          table: "oauth_client",
          operation: "update",
          rowId: clientId,
          after: { rotatedSecret: true },
        })
        return { clientSecret }
      },
    ),
  }
})

/**
 * The app's own product-permission catalog: the flat permissions members can
 * be granted (and that the permissions claim carries), and the resource types
 * per-instance grants such as `kirby:thread:<id>` compose under. Runtime data
 * the app declares, validated here, never kit grants.
 */
export const catalog = declareService((ctx) => ({
  declare: method(
    {
      summary: "Replace the app's product-permission catalog: its permissions and resource types",
      description:
        "Wholesale: omitting a permission removes it, omitting `resourceTypes` clears them. The IdP GETs each type's `list` URL (with a 60s IdP-signed JWT whose `aud` is that URL) whenever it needs the instances, and never stores them; a `list` URL must be absolute https (http only for loopback hosts), else 422.",
      permission: "app:update",
      hints: { idempotent: true },
      ...io("catalog.declare"),
    },
    async (input) => {
      const app = await registration(ctx)
      const permissions = [...new Set(input.permissions.map((p) => p.trim()).filter(Boolean))]
      const resourceTypes: ResourceTypeDecl[] = []
      for (const t of input.resourceTypes) {
        if (resourceTypes.some((seen) => seen.type === t.type)) continue
        if (!isCallableListUrl(t.list)) fail(422, `The list URL of ${t.type} isn't callable: ${t.list}`)
        resourceTypes.push({ type: t.type, label: t.label?.trim() || t.type, list: t.list.trim() })
      }
      // The IdP signs a short-lived JWT with `aud` = a type's list URL and GETs
      // it to read that type's instances. If another app could declare a list
      // URL pointing at a DIFFERENT app's endpoint, it would make the IdP mint a
      // token for — and hand it the instances of — an endpoint it doesn't own.
      // A list URL already used by another app is therefore refused here.
      const foreignList = await listUrlsOwnedByOtherApps(
        ctx,
        app.app,
        resourceTypes.map((t) => t.list),
      )
      if (foreignList.length)
        fail(409, `A list URL is already used by another application: ${foreignList.join(", ")}.`)
      await ctx.db
        .update(schema.oauthClient)
        .set({
          metadata: serializeAppMetadata({
            ...metadataOf(app),
            permissions,
            resource_types: resourceTypes,
          }),
        })
        .where(eq(schema.oauthClient.clientId, app.clientId))
      await ctx.audit.record({
        table: "oauth_client",
        operation: "update",
        rowId: app.clientId,
        after: { permissions, resourceTypes },
      })
      return { permissions, resourceTypes }
    },
  ),
}))
