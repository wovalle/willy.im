import { Directus } from "@directus/sdk"
import { z } from "zod"

// TODO: generate full schema from opeapi spec
const PlatformUserSchema = z.object({
  id: z.string(),
  platform: z.string(),
})

const env = z.object({
  ZOIDBERG_TOKEN: z.string(),
  ZOIDBERG_URL: z.string(),
  CF_ACCESS_CLIENT_ID: z.string(),
  CF_ACCESS_CLIENT_SECRET: z.string(),
})

const { ZOIDBERG_TOKEN, ZOIDBERG_URL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET } = env.parse(
  process.env
)

const directusSDK = new Directus(ZOIDBERG_URL, {
  auth: {
    staticToken: ZOIDBERG_TOKEN,
  },
  transport: {
    headers: {
      "CF-Access-Client-Id": CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": CF_ACCESS_CLIENT_SECRET,
    },
  },
})

export const directus = {
  getClient: () => directusSDK,
  saveReminder: async (opts: {
    text: string
    date: Date
    chatId: string | undefined
    messageId: string
  }) => {
    const data = {
      text: opts.text,
      date: opts.date.toISOString(),
      chat_id: opts.chatId,
      message_id: opts.messageId,
    }

    return directusSDK
      .items("reminders")
      .createOne(data)
      .then(() => ({ ok: true } as const))
      .catch((error) => {
        // The API could return an empty object - in which case the status text is logged instead.
        const message = error?.response?.data?.error?.message || error?.response?.statusText
        console.error("directus_error", "Error saving reminder", message)
        throw error
      })
  },
  saveChat: async (data: { id: string; platform: "telegram"; type: "individual" | "group" }) => {
    return directusSDK
      .items("chats")
      .createOne(data)
      .then(() => ({ ok: true } as const))
      .catch((error) => {
        // The API could return an empty object - in which case the status text is logged instead.
        const message = error?.response?.data?.error?.message || error?.response?.statusText
        console.error("directus_error", "Error saving chat", message)
        throw error
      })
  },
  getChat: async (userId: string) => {
    return directusSDK
      .items("chats")
      .readOne(userId)
      .then((r) => z.object(PlatformUserSchema.shape).parse(r))
      .catch((error) => {
        // The API could return an empty object - in which case the status text is logged instead.
        const message = error?.response?.data?.error?.message || error?.response?.statusText
        console.error("directus_error", "Error getting chat", message)
        return undefined
      })
  },
  saveMessage: async (data: { from: string; text: string; body: string; response: string }) => {
    return directusSDK
      .items("messages")
      .createOne(data)
      .then(() => ({ ok: true } as const))
      .catch((error) => {
        // The API could return an empty object - in which case the status text is logged instead.
        const message = error?.response?.data?.error?.message || error?.response?.statusText
        console.error("directus_error", "Error saving reminder", message)
        return { ok: false, message }
      })
  },
}
