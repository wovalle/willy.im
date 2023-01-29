import z from "zod"

import wretch from "wretch"
import QueryStringAddon from "wretch/addons/queryString"

type StrapiResponse =
  | {
      ok: true
    }
  | { ok: false; message: string }

const env = z.object({
  STRAPI_TOKEN: z.string(),
  CF_ACCESS_CLIENT_ID: z.string(),
  CF_ACCESS_CLIENT_SECRET: z.string(),
})

const StrapiUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  provider: z.string().optional(), // this is actually an enum but who cares
  confirmed: z.boolean(),
  blocked: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const { STRAPI_TOKEN, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET } = env.parse(process.env)

const strapiApi = wretch("https://os.willy.im/api")
  .headers({
    Authorization: `Bearer ${STRAPI_TOKEN}`,
    "CF-Access-Client-Id": CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": CF_ACCESS_CLIENT_SECRET,
  })
  .errorType("json")
  .addon(QueryStringAddon)
  .resolve((r) => r.json())

export const saveReminder = async (
  reminderText: string,
  reminderDate: Date,
  userId: number
): Promise<StrapiResponse> => {
  return strapiApi
    .url("/reminders")
    .post({
      data: {
        text: reminderText,
        date: reminderDate.toISOString(),
        user: {
          connect: [userId],
        },
      },
    })
    .then(() => ({ ok: true } as const)) // TODO: parse entity?
    .catch((error) => {
      // The API could return an empty object - in which case the status text is logged instead.
      const message =
        typeof error.message === "object" && Object.keys(error.message).length > 0
          ? JSON.stringify(error.message)
          : error.response.statusText

      console.error("strapi_error", "save_reminder", { message, error })

      return { ok: false, message }
    })
}

export const getUser = async (
  userId: number
): Promise<z.infer<typeof StrapiUserSchema> | undefined> => {
  return strapiApi
    .url("/users")
    .query({
      "filters[username]": userId,
    })
    .get()
    .then((r) => z.array(z.object(StrapiUserSchema.shape)).parse(r))
    .then((u) => u[0])
    .catch((error) => {
      // The API could return an empty object - in which case the status text is logged instead.
      const message =
        typeof error.message === "object" && Object.keys(error.message).length > 0
          ? JSON.stringify(error.message)
          : error.response.statusText

      console.error("strapi_error", "get_user", { message, error })

      return undefined
    })
}
