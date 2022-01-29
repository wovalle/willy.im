// eslint-disable-next-line @next/next/no-server-import-in-page
import { NextRequest, NextResponse } from "next/server"
import { Path } from "path-parser"
import { array, date, Infer, assert, nonempty, object, optional, refine, string } from "superstruct"
import isUrl from "validator/lib/isURL"

const Url = refine(string(), "url", (c) => isUrl(c))

const ShortyEntityStruct = object({
  key: nonempty(string()),
  to: Url,
  allowedUsers: optional(array(string())),
  password: optional(string()),
  expirationDate: optional(date()),
  meta: optional(object()),
})

export type ShortyEntity = Infer<typeof ShortyEntityStruct>

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
  basePath?: string
}

type Routes = "get_view" | "get_link" | "set_link" | "get_history"

const required = <T>(value: T | undefined | null, error?: string): T => {
  if (value === undefined || value === null) {
    throw new Error(error ?? `Value is required`)
  }

  return value
}

const normalizePath = (basePath?: string) => {
  if (!basePath || basePath === "/") {
    return ""
  }

  if (basePath.startsWith("/")) {
    return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
  }

  throw new Error("Invalid basePath: must start with '/'")
}

const parseRoute = (
  basePath: string,
  method: string,
  pathName: string
): [Routes, Record<string, string>] | [] => {
  const fullPath = `${method}${pathName}`

  const routes = [
    [new Path(`get${basePath}/`), "get_view"],
    [new Path(`get${basePath}/:key`), "get_link"],
    [new Path(`post${basePath}/:key`), "set_link"],
    [new Path(`get${basePath}/:user/history`), "get_history"],
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
  { onUrlGet, onAccessDenied, onExpired, basePath }: ShortyOpts
) => {
  const normalizedBasePath = normalizePath(basePath)
  const user = ""

  const [route, params] = parseRoute(normalizedBasePath, req.method, req.nextUrl.pathname)

  switch (route) {
    case "get_view": {
      return NextResponse.next()
    }

    case "get_link": {
      const key = required(params?.["key"])

      const entity = await onUrlGet({ key })

      // TODO:
      assert(entity, ShortyEntityStruct)

      if (entity.allowedUsers?.length && !entity.allowedUsers.includes(user)) {
        return onAccessDenied ? onAccessDenied({ key, user }) : null
      }

      if (entity.expirationDate && entity.expirationDate < new Date()) {
        return onExpired ? onExpired({ key, url: entity }) : null
      }

      return NextResponse.redirect(entity.to)
    }

    case "set_link": {
      throw new Error("not implemented")
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
