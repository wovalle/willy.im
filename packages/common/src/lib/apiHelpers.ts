import type { NextApiHandler } from "next"
import { asHandler, endpoint } from "next-better-api"

export type Decorator<T> = (handler: NextApiHandler<T>) => NextApiHandler<T>
type Endpoint = ReturnType<typeof endpoint>

export const filterRoutesDecorator =
  (maybeRoutes: string | string[], errorStr = "Ooops, invalid path"): Decorator<any> =>
  (handler) =>
  (req, res) => {
    const { path } = req.query
    const flatPath = Array.isArray(path) ? `/${path.join("/")}` : path

    const routes = Array.isArray(maybeRoutes) ? maybeRoutes : [maybeRoutes]

    if (!routes.some((r) => r === flatPath)) {
      return res.status(404).json({ error: errorStr })
    }

    return handler(req, res)
  }

export const mergeRouteHandlers =
  (maybeRoutes: Record<string, Endpoint>): NextApiHandler =>
  (req, res) => {
    const flatPath = Array.isArray(req.query.path)
      ? `/${req.query.path.join("/")}`
      : req.query.path ?? "/"

    const handler = maybeRoutes[flatPath]

    if (!handler) {
      res.status(404).end()
      return
    }

    return asHandler([handler])(req, res)
  }
