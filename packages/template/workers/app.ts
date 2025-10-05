import { createRequestHandler } from "react-router"

import { createDrizzleClient, type DrizzleClient } from "../app/db/drizzle"
import { getAppEnv } from "../app/lib/env"
import { createConsoleLogger, type ILogger } from "../app/lib/services"
import { createService1, type Service1 } from "../app/modules/service1/service1.service"

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
      service1: Service1
    }
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

export default {
  async fetch(request, env, ctx) {
    const db = createDrizzleClient(env.db)

    const serviceBaseContext = {
      getAppEnv,
      db,
      logger: createConsoleLogger(),
    }

    const service1 = createService1(serviceBaseContext)

    return requestHandler(request, {
      cloudflare: { env, ctx },
      db,
      logger: createConsoleLogger(),
      getAppEnv,
      services: {
        service1,
      },
    })
  },
} satisfies ExportedHandler<Env>
