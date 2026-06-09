import { createRequestHandler } from "react-router"

import type { DrizzleClient } from "../app/db/drizzle"
import { getAppEnv } from "../app/lib/env"
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
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

export default {
  async fetch(request, env, ctx) {
    const baseCtx = createBaseContext(env.db)

    return requestHandler(request, {
      cloudflare: { env, ctx },
      ...baseCtx,
    })
  },
} satisfies ExportedHandler<Env>
