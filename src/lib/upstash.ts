import { ShortenedUrl } from "../shorty/middleware"

const baseUrl = process.env.UPSTASH_REDIS_URL

const globalOptions: RequestInit = {
  headers: {
    Authorization: `Bearer ${process.env.UPSTASH_AUTH_CODE}`,
  },
}

const client = {
  get: async (url: string, opts: RequestInit = {}) => {
    const res = await fetch(baseUrl + url, { ...globalOptions, ...opts, method: "get" })

    return res.ok ? (await res.json()).result : null
  },
  post: async (url: string, data: any, opts: RequestInit = {}) => {
    const postData = ["string", "undefined"].includes(typeof data) ? data : JSON.stringify(data)

    const res = await fetch(baseUrl + url, {
      ...globalOptions,
      ...opts,
      body: postData,
      method: "post",
    })

    return res.ok ? (await res.json()).result : null
  },
}

export const setKey = async (key: string, data: ShortenedUrl) => {
  const res = await client.post("/set/" + key, data)

  return res ? JSON.parse(res) : null
}

export const getKey = async (key: string) => {
  const res = await client.get("/get/" + key)

  return res ? JSON.parse(res) : null
}
