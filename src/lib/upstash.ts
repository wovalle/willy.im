import { ShortenedUrl } from "../shorty/middleware"
import { default as axios, Options } from "redaxios"

const options: Options = {
  headers: {
    Authorization: `Bearer ${process.env.UPSTASH_AUTH_CODE}`,
  },
  baseURL: process.env.UPSTASH_REDIS_URL,
}

const client = axios.create(options)

export const setKey = async (key: string, data: ShortenedUrl) => {
  const req = await client.post("/set/" + key, JSON.stringify(data))

  return req.data
}

export const getKey = async (key: string) => {
  const req = await client.get("/get/" + key)

  return JSON.parse(req.data.result)
}
