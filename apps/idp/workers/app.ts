import * as Sentry from "@sentry/cloudflare"
import { createRequestHandler, RouterContextProvider } from "react-router"

import { appContext } from "../app/context"
import { serveApi, serveMcp } from "../app/kit.server"
import { getAppEnv } from "../app/lib/env"
import { createAuthService, idpAudience } from "../app/lib/auth.server"
import { allResources, syncResourceRegistry } from "../app/lib/claims.server"
import type { BaseServiceContext } from "../app/lib/services"

const AUDIENCE_TTL_MS = 60_000
let audienceCache: { at: number; value: string[] } | null = null

/** Every host the IdP answers on, as its own audience (`<origin>/auth`). */
function idpAudiences() {
  const extra = getAppEnv("IDP_EXTRA_DOMAINS")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .map((h) => `https://${h}`)
  return [new URL(getAppEnv("BETTER_AUTH_URL")).origin, ...extra].map(idpAudience)
}

/**
 * Resource URIs from every application, memoised per isolate for a minute.
 * Each refresh also disables `oauth_resource` rows no app declares any more.
 */
async function cachedAudiences(ctx: Pick<BaseServiceContext, "db">) {
  const now = Date.now()
  if (audienceCache && now - audienceCache.at < AUDIENCE_TTL_MS) return audienceCache.value
  try {
    const value = await allResources(ctx.db)
    await syncResourceRegistry(ctx.db, [...idpAudiences(), ...value])
    audienceCache = { at: now, value }
    return value
  } catch {
    // A failed load must not take the whole IdP down with it; the previous
    // list (or none) stands until the next request.
    return audienceCache?.value ?? []
  }
}
import { createBaseContext } from "../app/lib/services"
import { sentryOptions } from "../app/lib/error-reporting.server"
import { createIdpRequestTracker } from "../app/lib/luchy.server"
import { createResourceLister } from "../app/lib/resources.server"

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

const handler = {
  async fetch(request, env, ctx) {
    const started = Date.now()
    const url = new URL(request.url)
    const requestId = crypto.randomUUID().slice(0, 8)

    const baseCtx = createBaseContext(env.db, { requestId })
    // The token endpoint's valid audiences — every resource URI a registered
    // application declares. Cached across requests in this isolate; a newly
    // registered resource is usable within AUDIENCE_TTL_MS.
    const audiences = await cachedAudiences(baseCtx)
    baseCtx.logger.debug("request.start", {
      method: request.method,
      path: url.pathname,
      // surface whether a session cookie is even present (helps debug auth)
      hasSessionCookie: /better-auth\.session_token=/.test(request.headers.get("cookie") ?? ""),
    })

    // Host-aware: a request on a vanity IdP domain (IDP_EXTRA_DOMAINS)
    // gets that host as issuer/cookies/passkey RP.
    const auth = createAuthService(baseCtx, request.url, { audiences })
    // Listing tokens are signed for the canonical issuer regardless of which
    // vanity host served the request: an app verifies `iss` against one value.
    const resources = createResourceLister({
      auth,
      issuer: `${new URL(getAppEnv("BETTER_AUTH_URL")).origin}/auth`,
      logger: baseCtx.logger,
    })

    // Analytics (Luchy). Every mutation in the IdP is either a form POST whose
    // `intent` field names it, a method-discriminated API call, or an auth verb
    // whose path names it — so the event is DERIVED from the request instead of
    // being emitted by hand per route. `luchy/react-router` owns the mechanics;
    // `begin` must run before React Router consumes the body.
    const finishTracking = createIdpRequestTracker(baseCtx, auth).begin(request)

    try {
      const appCtx = { cloudflare: { env, ctx }, ...baseCtx, services: { auth, resources } }
      // kit's generated API (/api/<service>.<method>, /apps/<app>/api/…) and MCP
      // (/mcp, /mcp/<app>) first; everything else, /api/v1 included, is React Router's.
      const context = new RouterContextProvider()
      context.set(appContext, appCtx)
      const response =
        (await serveApi(appCtx, request)) ??
        (await serveMcp(appCtx, request)) ??
        (await requestHandler(request, context))
      baseCtx.logger.debug("request.end", {
        method: request.method,
        path: url.pathname,
        status: response.status,
        location: response.headers.get("location") ?? undefined,
        ms: Date.now() - started,
      })
      finishTracking(response, ctx)
      return response
    } catch (err) {
      baseCtx.logger.error("request.error", {
        method: request.method,
        path: url.pathname,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      throw err
    }
  },
} satisfies ExportedHandler<Env>

// GlitchTip (app/lib/error-reporting.server.ts). withSentry reports whatever
// escapes `fetch` and holds the per-request scope that Better Auth's and React
// Router's error hooks report into. The release is the Worker version
// (CF_VERSION_METADATA in wrangler.jsonc), so an issue names the deploy that
// introduced it.
export default Sentry.withSentry(() => sentryOptions(getAppEnv()), handler)
