import { Directus } from "@directus/sdk"
import { z } from "zod"

// TODO: generate full schema from opeapi spec
export const ArticleSchema = z.object({
  slug: z.string(),
  newspaper: z.string(),
  title: z.string(),
  author: z.string(),
  link: z.string(),
  publication_date: z.string().datetime(),
  content: z.string(),
  tags: z.array(z.string()),
})

export const KV = z.object({
  key: z.string(),
  value: z.string(),
})

const env = z.object({
  DIRECTUS_TOKEN: z.string(),
  DIRECTUS_URL: z.string(),
  CF_ACCESS_CLIENT_ID: z.string(),
  CF_ACCESS_CLIENT_SECRET: z.string(),
})

const { DIRECTUS_TOKEN, DIRECTUS_URL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET } = env.parse(
  process.env
)

const directusSDK = new Directus(DIRECTUS_URL, {
  auth: {
    staticToken: DIRECTUS_TOKEN,
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
  getKVItem: async (key: string) => {
    const result = await directusSDK.items("kv").readOne(key).then(KV.parse)

    return result.value
  },
}
