import z from "zod"

import { endpoint } from "next-better-api"
import { directus } from "./lib/directus"
import { sendMessage } from "./lib/telegram"

const getI18n = (key: string, reminder: unknown) => {
  return `${key} ${JSON.stringify(reminder)}`
}

export const handler = endpoint(
  {
    method: "post",
    bodySchema: z.object({
      secret: z.string(),
      reminderId: z.string(),
    }),
    responseSchema: z.object({
      ok: z.boolean(),
    }),
  },
  async ({ body }) => {
    const zoidbergSecret = await directus.getKVItem("zoidberg_secret_value")

    if (body?.secret !== zoidbergSecret) {
      return { body: { ok: false, error: "Invalid Secret" } }
    }

    const reminder = await directus.getReminder(body.reminderId)

    if (!reminder) {
      return { body: { ok: false, error: `Invalid reminder id: ${body.reminderId}` } }
    }

    const response = await sendMessage({
      text: getI18n("{{butler.replies.reminder}}", reminder),
      chatId: reminder.chat_id,
      replyTo: reminder.message_id,
    })

    return {
      body: {
        ok: true,
        response,
      },
    }
  }
)
