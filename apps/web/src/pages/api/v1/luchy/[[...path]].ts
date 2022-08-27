import { nextApiHandler } from "@luchyio/core"
import { PrismaAdapter } from "../../../../luchyPrismaAdapter"

export default nextApiHandler({
  adapter: PrismaAdapter,
  timePartition: "HOURLY",
})

export const config = {
  runtime: "nodejs",
}
