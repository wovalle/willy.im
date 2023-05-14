import { nextApiHandler } from "@luchyio/next"
import { logger } from "../../../lib/luchy"
import { KyselyAdapter } from "../../../luchyKyselyAdapter"

export default nextApiHandler({
  adapter: KyselyAdapter,
  timePartition: "HOURLY",
  logger,
})

export const config = {
  runtime: "nodejs",
}
