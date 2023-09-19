import { withLuchyMiddleware } from "@luchyio/next"
import { baseUrl } from "../constants"
import { logger } from "./lib/logger"

export const middleware = withLuchyMiddleware({
  origin: baseUrl,
  logger,
  apiHandlerPath: "/api/luchy",
})
