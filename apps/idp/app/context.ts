import { createContext } from "react-router"

import type { DrizzleClient } from "./db/drizzle"
import type { AuthService } from "./lib/auth.server"
import type { getAppEnv } from "./lib/env"
import type { ResourceLister } from "./lib/resources.server"
import type { ILogger } from "./lib/services"

/** What the worker hands every loader/action: bindings, db, logger, services. */
export type AppContext = {
  cloudflare: {
    env: Env
    ctx: ExecutionContext
  }
  db: DrizzleClient
  logger: ILogger
  getAppEnv: typeof getAppEnv
  services: {
    auth: AuthService
    /** Asks an app which instances of a declared resource type it holds. */
    resources: ResourceLister
  }
}

/** Set once per request in workers/app.ts; read with `context.get(appContext)`. */
export const appContext = createContext<AppContext>()
