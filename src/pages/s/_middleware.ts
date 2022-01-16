import { NextFetchEvent, NextRequest } from "next/server"
import { getKey, setKey } from "../../lib/upstash"
import { registerMiddleware } from "../../shorty/middleware"

export async function middleware(req: NextRequest, ev: NextFetchEvent) {
  return registerMiddleware(req, {
    // WIP
    onUrlCreate: async ({ key, data }) => {
      await setKey(key, data)
      throw new Error("Not implemented")
    },
    onUrlGet: async ({ key }) => getKey(key),
    basePath: "/s",
  })
}
