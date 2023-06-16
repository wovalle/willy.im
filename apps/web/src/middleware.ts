import { withLuchyMiddleware } from "@luchyio/next"
import type { NextMiddleware } from "next/server"
import { logger } from "./lib/logger"

const deploymentUrl = process.env.NEXT_PUBLIC_DEPLOYMENT_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL

const baseUrl =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : `https://${deploymentUrl ?? "willy.im"}`

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
