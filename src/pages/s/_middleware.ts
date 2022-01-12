import { NextFetchEvent, NextRequest } from "next/server"
import { getKey } from "../../lib/upstash"
import { registerMiddleware } from "../../shorty/middleware"

export async function middleware(req: NextRequest, ev: NextFetchEvent) {
  return registerMiddleware(req, ev, {
    onUrlCreate: async (_url, _data) => {
      // await setKey(url, data)
      throw new Error("Not implemented")
    },
    onUrlGet: (url) => getKey(url),
    basePath: "/s",
  })
}
