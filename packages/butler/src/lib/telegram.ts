import z from "zod"

import wretch from "wretch"

type TgMessage = {
  text: string
  chatId: number | string
  replyTo?: number | string | undefined
}

type TgApiResponse =
  | {
      ok: true
    }
  | { ok: false; error: string }

const env = z.object({
  TELEGRAM_TOKEN: z.string(),
})

const { TELEGRAM_TOKEN } = env.parse(process.env)

const telegramApi = wretch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}`)
  .errorType("json")
  .resolve((r) => r.json())

export const sendMessage = async (message: TgMessage): Promise<TgApiResponse> => {
  return telegramApi
    .url("/sendMessage")
    .post({
      chat_id: message.chatId,
      text: message.text,
      reply_to_message_id: message.replyTo,
    })
    .then(() => ({ ok: true } as const))
    .catch((error) => {
      // The API could return an empty object - in which case the status text is logged instead.
      const message =
        typeof error.message === "object" && Object.keys(error.message).length > 0
          ? JSON.stringify(error.message)
          : error.response.statusText

      console.error("telegram_error", "send_message", { message, error })

      return { ok: false, error: message ?? error }
    })
}
