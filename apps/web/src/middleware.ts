import { withLuchyMiddleware } from "@luchyio/next"
import type { NextMiddleware } from "next/server"
import { basePath, baseUrl, logger } from "./lib/luchy"

export function withMiddleware(...middlewares: NextMiddleware[]): NextMiddleware {
  return async (req, ev) => {
    for await (const middleware of middlewares) {
      await middleware(req, ev)
    }

    return undefined
  }
}

export const middleware = withMiddleware(withLuchyMiddleware({ baseUrl, basePath, logger }))
