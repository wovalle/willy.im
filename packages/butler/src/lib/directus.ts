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
  saveReminder: async (reminderText: string, reminderDate: Date, userId: string) => {
    const data = {
      text: reminderText,
      date: reminderDate.toISOString(),
      platform_user: userId,
    }

    return directusSDK
      .items("reminders")
      .createOne(data)
      .then(() => ({ ok: true } as const))
      .catch((error) => {
        // The API could return an empty object - in which case the status text is logged instead.
        const message = error?.response?.data?.error?.message || error?.response?.statusText
        console.error("directus_error", "Error saving reminder", message)
        return { ok: false, message }
      })
  },

  getUser: async (userId: string) => {
    return directusSDK
      .items("platform_users")
      .readOne(userId)
      .then((r) => z.object(PlatformUserSchema.shape).parse(r))
      .catch((error) => {
        // The API could return an empty object - in which case the status text is logged instead.
        const message = error?.response?.data?.error?.message || error?.response?.statusText
        console.error("directus_error", "Error getting user", message)
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
