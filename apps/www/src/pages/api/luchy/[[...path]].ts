import { getKyselyAdapter } from "@luchyio/adapter-kysely"
import { nextApiHandler } from "@luchyio/next"
import { getLuchyDb } from "../../../db/kysely"
import { logger } from "../../../lib/logger"

export default nextApiHandler({
  adapter: getKyselyAdapter(getLuchyDb()),
  timePartition: "HOURLY",
  logger,
})

export const config = {
  runtime: "nodejs",
}
