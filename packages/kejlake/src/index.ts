import { mergeRouteHandlers } from "@willyim/common"
import { handleRSS } from "./rss"

export const handler = mergeRouteHandlers(
  {
    "/rss": handleRSS,
  },
  []
)
