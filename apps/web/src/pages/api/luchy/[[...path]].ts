import { nextApiHandler } from "@luchyio/next"
import { logger } from "../../../lib/logger"
import { backendAdapter } from "../../../luchyKyselyAdapter"

export default nextApiHandler({
  adapter: backendAdapter,
  timePartition: "HOURLY",
  logger,
})

export const config = {
  runtime: "nodejs",
}
