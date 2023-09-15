import { withLuchyMiddleware } from "@luchyio/next"
import type { NextMiddleware } from "next/server"
import { baseUrl } from "./constants"
import { logger } from "./src/lib/logger"

export function withMiddleware(...middlewares: NextMiddleware[]): NextMiddleware {
  return async (req, ev) => {
    for await (const middleware of middlewares) {
      await middleware(req, ev)
    }

    return undefined
  }
}

export const middleware = withLuchyMiddleware({
  apiHandlerPath: "/api/luchy",
  origin: baseUrl,
  logger,
})
