import { handleTelegramMessage } from "@willyim/butler"
import { asHandler } from "next-better-api"
import { filterRoutesDecorator } from "src/lib/apiHelpers"

export default asHandler([handleTelegramMessage], {
  decorators: [filterRoutesDecorator(["/channels/telegram"])],
})

export const config = {
  runtime: "nodejs",
}
