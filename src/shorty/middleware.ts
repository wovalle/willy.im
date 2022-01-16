// eslint-disable-next-line @next/next/no-server-import-in-page
import { NextRequest, NextResponse } from "next/server"
import { Path } from "path-parser"

export interface ShortyEntity {
  key: string
  to: string
  allowedUsers?: string[]
  password?: string
  expirationDate?: Date
}

type ShortyParams = {
  key: string
}

export type ShortyOpts = {
  onUrlCreate: (params: ShortyParams & { data: ShortyEntity }) => Promise<void>
  onUrlGet: (params: ShortyParams) => Promise<ShortyEntity>
  onAccessDenied?: (params: ShortyParams & { user: string }) => Promise<void>
  onExpired?: (params: ShortyParams & { url: ShortyEntity }) => Promise<void>
  getHistory?: (params: ShortyParams) => Promise<void>
  prepend?: string
  basePath: string
}

type Routes = "get_view" | "get_link" | "set_link" | "get_history"

const required = <T>(value: T | undefined | null, error?: string): T => {
  if (value === undefined || value === null) {
    throw new Error(error ?? `Value is required`)
  }

  return value
}

const parseRoute = (
  basePath: string,
  method: string,
  pathName: string
): [Routes, Record<string, string>] | [] => {
  const fullPath = `${method}/${pathName}`
  const routes = [
    [new Path(`get/${basePath}`), "get_view"],
    [new Path(`get/${basePath}/:key`), "get_link"],
    [new Path(`post/${basePath}/:key`), "set_link"],
    [new Path(`get/${basePath}/:user/history`), "get_history"],
  ] as const

  const matchedPath = routes.find(([p]) => p.test(fullPath))
  const pathParams = matchedPath ? matchedPath[0].test(fullPath) || {} : {}

  return matchedPath ? [matchedPath?.[1] as Routes, pathParams] : []
}

export const assertUnreachable = (_: never): never => {
  throw new Error("should never happen")
}

export const registerMiddleware = async (
  req: NextRequest,
  { onUrlCreate, onUrlGet, onAccessDenied, onExpired, prepend = "", basePath = "/" }: ShortyOpts
) => {
  const user = ""

  const [route, params] = parseRoute(basePath, req.method, req.nextUrl.pathname)

  switch (route) {
    case "get_view": {
      return NextResponse.next()
    }

    case "get_link": {
      const key = required(params?.["key"])

      const url = await onUrlGet({ key })

      if (!url) {
        return NextResponse.redirect("/404")
      }

      if (url.allowedUsers?.length && !url.allowedUsers.includes(user)) {
        return onAccessDenied ? onAccessDenied({ key, user }) : null
      }

      if (url.expirationDate && url.expirationDate < new Date()) {
        return onExpired ? onExpired({ key, url }) : null
      }

      return NextResponse.redirect(url.to)
    }

    case "set_link": {
      // TODO: validate body
      const data = req.body as unknown as ShortyEntity
      const key = data.key

      await onUrlCreate({ key, data })

      return NextResponse.json({ saved: true })
    }

    case "get_history": {
      throw new Error("not implemented")
    }

    case undefined: {
      throw new Error("not implemented")
    }

    default:
      assertUnreachable(route)
  }
}
