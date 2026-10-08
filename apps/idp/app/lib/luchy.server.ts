import type { RouterContextProvider } from "react-router"
import { createLuchy, type LuchyIdentity, type LuchyPayload } from "luchy/server"
import {
  luchyMiddleware,
  type LuchyMiddlewareArgs,
  type LuchyRequestIdentity,
  type ServerEventNameConfig,
} from "luchy/react-router"

import { appContext, type AppContext } from "../context"
import { principalFrom } from "./caller.server"

/**
 * Luchy analytics, server side.
 *
 * Every mutation in the IdP is either a form POST whose `intent` field names
 * it, or an API call or auth verb whose path names it — so the event is
 * DERIVED from the request (`luchy/react-router` owns the mechanics) instead
 * of being emitted by hand per route. The same pass resolves who the request
 * belongs to and signs it, so the browser script (`<LuchyScript>` in
 * `root.tsx`, fed by `getLuchy` in the root loader) lands pageviews in the
 * same session as server events.
 *
 * The middleware runs in the Worker (`workers/app.ts`) around the whole
 * dispatch rather than as a root route middleware: kit's HTTP API and MCP are
 * answered before React Router, and API mutations are events too.
 */

/** Public ingest key — it ships in the HTML for the browser script too. */
export const LUCHY_API_KEY = "f7060145b46b4668a609b2c6b79c04a3"

/**
 * Deviations from the package defaults, on purpose: auth *is* this product, so
 * failures are kept (`status` rides in the payload) and intent-less mutations
 * (API calls, auth verbs) carry their method as a suffix (`:post`).
 */
export const LUCHY_TRACKER_OPTIONS = {
  trackFailures: true,
  methodSuffix: true,
  // Consumer apps validate end-user API keys on (potentially) every request
  // they serve. That is key plumbing, not product usage — it already bumps
  // `lastUsedAt` on the key row, and here it would drown everything else.
  ignoreRouteSuffixes: ["/user_keys.validate"],
} satisfies ServerEventNameConfig

/**
 * Who a request is, in Luchy's terms.
 *
 * A signed-in human is `user` (the account the session acts as), with their
 * name and email as profile traits; `actor` is the admin at the keyboard while
 * they impersonate someone. A bearer key is not a person: it is identified by
 * its audit label (`apikey:<id>`, `adminkey:<id>`) so machine usage is
 * segmentable, with its kind and app as props. Anonymous traffic carries
 * neither header and must not pay for a lookup that can only miss.
 */
export async function luchyIdentity({
  request,
  context,
}: Pick<LuchyMiddlewareArgs, "request" | "context">): Promise<LuchyRequestIdentity | undefined> {
  const app = context.get(appContext)
  if (request.headers.get("authorization")) return keyIdentity(request, app)
  if (!request.headers.get("cookie")) return undefined

  const session = await app.services.auth.api.getSession({ headers: request.headers })
  if (!session) return undefined

  return {
    user: session.user.id,
    actor: session.session.impersonatedBy ?? undefined,
    props: session.user.role === "admin" ? { admin: true } : undefined,
    traits: { name: session.user.name, email: session.user.email },
  }
}

async function keyIdentity(request: Request, app: AppContext): Promise<LuchyRequestIdentity | undefined> {
  const principal = await principalFrom(request, app, app.services.auth)
  if (!principal) return undefined

  const props: LuchyPayload = { kind: principal.grants.includes("*") ? "superadmin" : "key" }
  const tenant = principal.memberships[0]?.tenantId
  if (tenant) props.app = tenant
  return { user: principal.id, props }
}

/**
 * Runs `next` (the Worker's whole dispatch) under the Luchy middleware: one
 * `server` event per mutation, and the per-request state `getLuchy` reads.
 * Events ship only in production; the secret (`LUCHY_SECRET_KEY`) signs the
 * identity and authenticates `identify`.
 */
export function trackRequest(
  request: Request,
  context: RouterContextProvider,
  next: () => Promise<Response>,
): Promise<Response> {
  const app = context.get(appContext)
  const url = new URL(request.url)
  const middleware = luchyMiddleware({
    ...LUCHY_TRACKER_OPTIONS,
    apiKey: LUCHY_API_KEY,
    secret: app.getAppEnv("LUCHY_SECRET_KEY"),
    enabled: app.getAppEnv("APP_ENV") === "production",
    waitUntil: () => (promise) => app.cloudflare.ctx.waitUntil(promise),
    identity: luchyIdentity,
    onError: (error) =>
      app.logger.warn("luchy.dropped", { error: error instanceof Error ? error.message : String(error) }),
  })
  // No route has matched yet at this level, so the pattern is the raw path.
  return middleware({ request, url, pattern: url.pathname, params: {}, context }, next)
}

/** Fire-and-forget server event, for the rare mutation the middleware can't see. */
export async function trackServerEvent(
  app: AppContext,
  event: {
    name: string
    pathname: string
    userAgent?: string
    payload?: LuchyPayload
  },
  identity: LuchyIdentity,
): Promise<void> {
  const luchy = createLuchy({
    apiKey: LUCHY_API_KEY,
    secret: app.getAppEnv("LUCHY_SECRET_KEY"),
    enabled: app.getAppEnv("APP_ENV") === "production",
  })
  await luchy.track({ ...event, type: "server" }, identity)
}
