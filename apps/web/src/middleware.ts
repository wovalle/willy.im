import { withLuchyMiddleware } from "@luchyio/core"
import type { NextMiddleware } from "next/server"
import Logger from "pino"

const baseUrl =
  process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://willy.im"

export function withMiddleware(...middlewares: NextMiddleware[]): NextMiddleware {
  return async (req, ev) => {
    for await (const middleware of middlewares) {
      await middleware(req, ev)
    }

    return undefined
  }
}

export const middleware = withMiddleware(
  withLuchyMiddleware({ baseUrl, getLogger: (name) => Logger({ name }) })
)
