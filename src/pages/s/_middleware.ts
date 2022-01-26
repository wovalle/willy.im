import { NextFetchEvent, NextRequest } from "next/server"
import { getKey } from "../../lib/upstash"
import { registerMiddleware } from "../../shorty/middleware"

export async function middleware(req: NextRequest, _ev: NextFetchEvent) {
  return registerMiddleware(req, {
    // WIP
    onUrlCreate: async () => {
      throw new Error("Not implemented")
    },
    onUrlGet: async ({ key }) => getKey(key),
    basePath: "/s",
  })
}
