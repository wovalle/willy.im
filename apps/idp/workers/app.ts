import { createRequestHandler } from "react-router"

import type { DrizzleClient } from "../app/db/drizzle"
import { getAppEnv } from "../app/lib/env"
import { createAuthService, type AuthService } from "../app/lib/auth.server"
import { allResources } from "../app/lib/claims.server"
import type { BaseServiceContext } from "../app/lib/services"

const AUDIENCE_TTL_MS = 60_000
let audienceCache: { at: number; value: string[] } | null = null

/** Resource URIs from every application, memoised per isolate for a minute. */
async function cachedAudiences(ctx: Pick<BaseServiceContext, "db">) {
  const now = Date.now()
  if (audienceCache && now - audienceCache.at < AUDIENCE_TTL_MS) return audienceCache.value
  try {
    const value = await allResources(ctx.db)
    audienceCache = { at: now, value }
    return value
  } catch {
    // A failed load must not take the whole IdP down with it; the previous
    // list (or none) stands until the next request.
    return audienceCache?.value ?? []
  }
}
import { createBaseContext, type ILogger } from "../app/lib/services"
import { carriesIntent, isMutatingMethod, serverEventName, trackServerEvent } from "../app/lib/luchy"

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
    }
    db: DrizzleClient
    logger: ILogger
    getAppEnv: typeof getAppEnv
    services: {
      auth: AuthService
    }
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

export default {
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

    // Analytics (Luchy). Every mutation in the IdP is either a form POST whose
    // `intent` field names it, a method-discriminated API call, or an auth verb
    // whose path names it — so the event is DERIVED from the request the Worker
    // already has (see app/lib/luchy.ts) instead of being emitted by hand per
    // route. The clone is taken before React Router consumes the body and read
    // after the response is sent.
    const tracksEvent = env.APP_ENV === "production" && isMutatingMethod(request.method)
    const trackedBody =
      tracksEvent && carriesIntent(request.headers.get("content-type")) ? request.clone() : null

    try {
      const auth = createAuthService(baseCtx, request.url, { audiences })
      const response = await requestHandler(request, {
        cloudflare: { env, ctx },
        ...baseCtx,
        services: {
          // Host-aware: a request on a vanity IdP domain (IDP_EXTRA_DOMAINS)
          // gets that host as issuer/cookies/passkey RP.
          auth,
        },
      })
      baseCtx.logger.debug("request.end", {
        method: request.method,
        path: url.pathname,
        status: response.status,
        location: response.headers.get("location") ?? undefined,
        ms: Date.now() - started,
      })
      if (tracksEvent) {
        const status = response.status
        ctx.waitUntil(
          (async () => {
            // Read the clone first, unconditionally: a cloned body left
            // unread stays buffered for the life of the request.
            const intent = trackedBody
              ? new URLSearchParams(await trackedBody.text()).get("intent")
              : null
            const name = serverEventName({
              method: request.method,
              pathname: url.pathname,
              status,
              intent,
            })
            if (!name) return
            // Only signed-in traffic carries a session; a bearer-token API
            // call must not pay for a lookup that can only miss.
            const session = request.headers.get("cookie")
              ? await auth.api.getSession({ headers: request.headers }).catch(() => null)
              : null
            const payload: Record<string, string | number | boolean> = { status }
            if (session) {
              payload.user = session.user.id
              if (session.user.role === "admin") payload.admin = true
              if (session.session.impersonatedBy) payload.impersonated = true
            }
            await trackServerEvent({
              name,
              pathname: url.pathname,
              userAgent: request.headers.get("user-agent") ?? undefined,
              payload,
            })
          })().catch(() => {}),
        )
      }
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
