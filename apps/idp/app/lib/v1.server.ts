import type { Context } from "@willyim/kit"
import type { RouterContextProvider } from "react-router"

import { appContext } from "../context"
import { app, depsOf } from "../kit.server"
import { appKeyOf } from "./admin.server"
import { principalFrom } from "./caller.server"

/**
 * `/api/v1`: the REST API the SDK's previous major speaks, kept while
 * invoices, bender and luchy move to the new one so their key validation never
 * breaks. Each route is one call to the same kit method the generated API
 * (`/api/<service>.<method>`) serves; nothing is decided here. Deleted with
 * `/api/v1`.
 *
 * Errors are kit's (400 `{ error, fields }`, `fail()`'s `{ error }`), except
 * the two shapes old clients parse: 401 `unauthorized` and 403 `forbidden`.
 */
export async function v1(
  args: { request: Request; context: Readonly<RouterContextProvider> },
  tenant: string | null,
  // The body is validated by the method's contract.
  // biome-ignore lint/suspicious/noExplicitAny: kit parses it
  call: (ctx: Context, body: any) => Promise<unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: the method's output
  status: number | ((value: any) => number) = 200,
): Promise<Response> {
  const { request } = args
  const c = args.context.get(appContext)
  const principal = await principalFrom(request, c, c.services.auth)
  if (!principal) return Response.json({ error: "unauthorized" }, { status: 401 })
  try {
    // An app the caller holds nothing in is a 404 to kit (tenants don't leak); v1 said 403.
    const ctx = await app.context(principal, tenant, depsOf(c, request)).catch((e) => {
      throw e instanceof Response && e.status === 404 ? forbidden() : e
    })
    let body: unknown
    if (request.method !== "GET" && request.method !== "DELETE") {
      const text = await request.text()
      try {
        body = text.trim() ? JSON.parse(text) : {}
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 })
      }
    }
    const value = await call(ctx, body)
    return Response.json(value, { status: typeof status === "number" ? status : status(value) })
  } catch (e) {
    if (!(e instanceof Response)) throw e
    // kit's own denial is plain text; a method's fail(403, …) keeps its message.
    return e.status === 403 && !e.headers.get("content-type")?.includes("json") ? forbidden() : e
  }
}

const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 })

/** The app a client id is tagged with: the tenant its methods run in. */
export const tenantOf = (args: {
  params: { clientId: string }
  context: Readonly<RouterContextProvider>
}) => appKeyOf(args.context.get(appContext), args.params.clientId)

/** An unknown client id is a 404 — after v1() authenticated, so a prober can't map ids. */
export const missing = async (): Promise<never> => {
  throw Response.json({ error: "not_found" }, { status: 404 })
}

/** 405 for a verb a resource doesn't serve, naming the ones it does. */
export function methodNotAllowed(allow: string[]): Response {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: allow.join(", ") } },
  )
}
