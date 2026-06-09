import { createRequestHandler } from "react-router"

import type { DrizzleClient } from "../app/db/drizzle"
import { getAppEnv } from "../app/lib/env"
import { createAuthService, type AuthService } from "../app/lib/auth.server"
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
    baseCtx.logger.info("request.start", {
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
          auth: createAuthService(baseCtx),
        },
      })
      baseCtx.logger.info("request.end", {
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
