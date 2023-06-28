import { mergeRouteHandlers } from "@willyim/common"
import { handler as handleRedirect } from "./handleRedirect"
import { handler as handleTelegramMessage } from "./handleTelegramMessage"
import { handler as handleTelegramReminder } from "./handleTelegramReminder"

export const handler = mergeRouteHandlers({
  "/r": handleRedirect,
  "/telegram/message": handleTelegramMessage,
  "/telegram/reminder": handleTelegramReminder,
})
