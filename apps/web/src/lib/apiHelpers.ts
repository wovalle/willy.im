import type { NextApiHandler } from "next"

export type Decorator<T> = (handler: NextApiHandler<T>) => NextApiHandler<T>

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
