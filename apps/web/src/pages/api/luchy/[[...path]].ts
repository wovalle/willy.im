import { nextApiHandler } from "@luchyio/next"
import { logger } from "../../../lib/luchy"
import { PrismaAdapter } from "../../../luchyPrismaAdapter"

export default nextApiHandler({
  adapter: PrismaAdapter,
  timePartition: "HOURLY",
  logger,
})

export const config = {
  runtime: "nodejs",
}
