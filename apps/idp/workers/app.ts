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

    try {
      const response = await requestHandler(request, {
        cloudflare: { env, ctx },
        ...baseCtx,
        services: {
          // Host-aware: a request on a vanity IdP domain (IDP_EXTRA_DOMAINS)
          // gets that host as issuer/cookies/passkey RP.
          auth: createAuthService(baseCtx, request.url, { audiences }),
        },
      })
      baseCtx.logger.debug("request.end", {
        method: request.method,
        path: url.pathname,
        status: response.status,
        location: response.headers.get("location") ?? undefined,
        ms: Date.now() - started,
      })
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
