import type { KitApp } from "./app.js"
import { llmsTxt, openapi, visibleTo } from "./discovery.js"
import { locked, lockedLlmsTxt, lockedOpenapi, unauthenticated } from "./locked.js"
import { available, invoke, permitted, unknownMethod } from "./method.js"
import type { PermissionChecker } from "./permissions.js"
import { checkedServices, registry } from "./registry.js"

/**
 * What `handle` needs from a context: the caller, and the services built on it.
 * `kind: "anonymous"` (no credentials at all) makes discovery list every method
 * as documentation (see `discovery.anonymous`); any other caller sees only what
 * it may call. Calls always run the checked services, even when handed the
 * context a factory closes over.
 */
export type HandlerContext = {
  caller: PermissionChecker<any> & { kind?: string }
  services: object
}

const error = (status: number, message: string, headers?: HeadersInit) =>
  Response.json({ error: message }, { status, headers })

/**
 * The agent API, over the same services and context the UI uses:
 *
 *   POST /api/<service>.<method>   JSON in (no body when the method takes no input),
 *                                  200 JSON out parsed by the contract's output, or 204
 *   GET  /openapi.json             OpenAPI 3.1, the methods this caller may call
 *   GET  /llms.txt                 the same, as markdown for a model to read
 *
 * Returns null for any other path, so the UI's router takes it. A thrown
 * `Response` (400, 403, 404, 409 from a method) is returned as is; any other
 * error is rethrown.
 */
export async function handle(
  app: KitApp,
  request: Request,
  ctx: HandlerContext,
): Promise<Response | null> {
  const url = new URL(request.url)
  const { pathname } = url

  if (pathname === "/openapi.json" || pathname === "/llms.txt") {
    if (request.method !== "GET" && request.method !== "HEAD")
      return error(405, "use GET", { allow: "GET, HEAD" })
    if (locked(app, ctx.caller))
      return pathname === "/openapi.json"
        ? Response.json(lockedOpenapi(app, url.origin))
        : new Response(lockedLlmsTxt(app), {
            headers: { "content-type": "text/markdown; charset=utf-8" },
          })
    const methods = visibleTo(app, registry(app), ctx)
    return pathname === "/openapi.json"
      ? Response.json(openapi(app, methods, url.origin))
      : new Response(llmsTxt(app, methods, url.origin), {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        })
  }

  if (!pathname.startsWith("/api/")) return null
  // No credentials and no anonymous discovery: a 401 before any lookup, so nothing leaks.
  if (locked(app, ctx.caller)) return unauthenticated(app)
  const name = pathname.slice("/api/".length)
  const entry = registry(app).find((e) => e.name === name)
  // A method hidden by `when` answers exactly like one that doesn't exist, whatever the verb.
  if (!entry || !available(entry.contract, ctx)) return unknownMethod(name)
  if (request.method !== "POST") return error(405, `call ${name} with POST`, { allow: "POST" })

  const { input, output } = entry.contract
  try {
    const bound = checkedServices(ctx.services)[entry.service][entry.method]
    // A denied caller gets its 403 (and onCall fires) whatever the body.
    const body =
      input && permitted(ctx.caller, entry.contract.permission)
        ? await readJson(request)
        : undefined
    // `parsed` is the output stripped to the contract: an internal column never reaches an agent.
    const parsed = await invoke(bound, body)
    if (!output) return new Response(null, { status: 204 })
    return Response.json(parsed)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

/** The JSON body; an empty body is `{}`, so methods whose fields are all optional need none. */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw error(400, "the body is not valid JSON")
  }
}
