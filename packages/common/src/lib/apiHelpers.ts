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
  (maybeRoutes: Record<string, Endpoint>, decorators: Decorator<unknown>[] = []): NextApiHandler =>
  (req, res) => {
    const flatPath = Array.isArray(req.query.path)
      ? `/${req.query.path.join("/")}`
      : req.query.path ?? "/"

    for (const path of Object.keys(maybeRoutes)) {
      if (flatPath.startsWith(path)) {
        const handler = maybeRoutes[path]

        return asHandler([handler], {
          decorators,
        })(req, res)
      }
    }

    res.status(404).end()
    return
  }
