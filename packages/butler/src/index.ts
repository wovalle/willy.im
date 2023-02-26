import { mergeRouteHandlers } from "@willyim/common"
import { handler as handleTelegramMessage } from "./handleTelegramMessage"
import { handler as handleTelegramReminder } from "./handleTelegramReminder"

export const handler = mergeRouteHandlers({
  "/telegram/message": handleTelegramMessage,
  "/telegram/reminder": handleTelegramReminder,
})
