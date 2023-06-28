import { endpoint } from "next-better-api"
import { z } from "zod"
import { directus } from "./lib/directus"

export const handler = endpoint(
  {
    method: "get",
    querySchema: z.object({
      pass: z.string().optional(),
    }),
  },
  async ({ query, req }) => {
    try {
      const key = req.url?.split("/").pop() ?? ""

      const redirect = await directus.getRedirect(key)

      if (redirect.password && redirect.password !== query.pass) {
        throw new Error("Unauthorized")
      }

      return {
        redirect: redirect.url,
      }
    } catch (e) {
      console.error("Error in Redirect: ", e)
    }

    return {
      status: 404,
    }
  }
)
