// eslint-disable-next-line @next/next/no-server-import-in-page
import { NextFetchEvent, NextRequest, NextResponse } from "next/server"

export interface ShortenedUrl {
  to: string
  id: string
  allowedUsers?: string[]
  password?: string
  expirationDate?: Date
}

type MiddlewareOpts = {
  onUrlCreate: (url: string, data: ShortenedUrl) => Promise<void>
  onUrlGet: (url: string) => Promise<ShortenedUrl>
  onAccessDenied?: (who: string) => Promise<void>
  onExpired?: (who: string) => Promise<void>
  getHistory?: (who: string) => Promise<void>
  prepend?: string
  basePath: string
}

export const registerMiddleware = async (
  req: NextRequest,
  ev: NextFetchEvent,
  { onUrlGet, onAccessDenied, onExpired, basePath }: MiddlewareOpts
) => {
  const user = ""

  if (req.url === basePath || req.url == "/") {
    return null
  }

  const path = req.url.slice(basePath.length + 1)

  const url = await onUrlGet(path)

  if (url.allowedUsers && !url.allowedUsers.includes(user)) {
    return onAccessDenied ? onAccessDenied(user) : null
  }

  if (url.expirationDate && url.expirationDate < new Date()) {
    return onExpired ? onExpired(user) : null
  }
  return NextResponse.redirect(url.to)
}
