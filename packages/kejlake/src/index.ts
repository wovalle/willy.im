import { mergeRouteHandlers } from "@willyim/common"
import { handleListin } from "./listin"

export const handler = mergeRouteHandlers({ "/listin": handleListin })
