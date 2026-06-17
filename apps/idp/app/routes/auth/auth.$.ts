import type { Route } from "./+types/auth.$"

async function handle(request: Request, context: Route.LoaderArgs["context"]) {
  const url = new URL(request.url)
  const op = url.pathname.replace(/^\/auth\//, "")
  const log = context.logger.child({ op })
  log.debug("auth.op.start", { method: request.method })
  try {
    const res = await context.services.auth.handler(request)
    log.info("auth.op.end", { status: res.status, location: res.headers.get("location") ?? undefined })
    return res
  } catch (err) {
    log.error("auth.op.error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    throw err
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  return handle(request, context)
}

export async function action({ request, context }: Route.ActionArgs) {
  return handle(request, context)
}
