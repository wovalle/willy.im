/**
 * @willyim/idp/react-router — the whole auth layer as one splat route and two
 * guards.
 *
 *   // app/routes/auth.$.tsx
 *   export const { loader, action } = createAuthRoute(({ context }) => context.idp)
 *
 *   // anywhere
 *   const session = await requireSession(args)
 *   const session = await requirePermission(args, "admin")
 *
 *   // from the browser, when there's no loader to read
 *   await fetch("/auth/me").then((r) => r.json())  // { user: PublicSession | null }
 *
 * No react-router import: the adapter only ever produces `Response`s and
 * functions, both of which react-router already understands. That keeps the
 * subpath dependency-free too, and makes it usable from any framework whose
 * handlers take a `Request`.
 */

import type { Idp, Session } from "../session.js"
import { publicSession, safeNext } from "../session.js"

/** The loader/action argument shape, narrowed to what the adapter reads. */
export type RouteArgs = {
  request: Request
  context?: unknown
  params?: Record<string, string | undefined>
}

export type IdpResolver = (args: RouteArgs) => Idp | Promise<Idp>

export type AuthRouteOptions = {
  /** Where this splat route is mounted. Default `/auth`. */
  basePath?: string
  /** Where to land after a login with no `?next=`. Default `/`. */
  defaultRedirect?: string
  /** Where to land after logout. Default `defaultRedirect`. */
  logoutRedirect?: string
  /**
   * Also end the IdP's SSO session on logout (RP-initiated logout). Default
   * true. Set false to keep logout app-local — useful while the OAuth client
   * has no `enable_end_session` / `post_logout_redirect_uris` registered.
   */
  idpLogout?: boolean
  /**
   * The registered OAuth redirect URI. Defaults to `${origin}${basePath}/callback`,
   * which is what you register in the IdP console.
   */
  redirectUri?: (request: Request) => string
}

/**
 * Serves `/auth/login`, `/auth/callback` and `/auth/logout` from a single splat
 * route. `loader` covers the GET navigations; `action` covers a POSTed logout
 * (and login), which is what you want from a form so a link prefetch can't log
 * anyone out.
 */
export function createAuthRoute(getIdp: IdpResolver, options: AuthRouteOptions = {}) {
  const basePath = (options.basePath ?? "/auth").replace(/\/+$/, "")
  const defaultRedirect = options.defaultRedirect ?? "/"
  const logoutRedirect = options.logoutRedirect ?? defaultRedirect

  const redirectUriFor = (request: Request) =>
    options.redirectUri?.(request) ?? new URL(`${basePath}/callback`, request.url).toString()

  async function handle(args: RouteArgs): Promise<Response> {
    const url = new URL(args.request.url)
    const action = url.pathname.slice(url.pathname.lastIndexOf("/") + 1)
    const idp = await getIdp(args)

    if (action === "login") {
      const next = safeNext(url.searchParams.get("next"))
      const { url: authorizeUrl, headers } = await idp.startLogin({
        redirectUri: redirectUriFor(args.request),
        next,
        prompt: url.searchParams.get("prompt") ?? undefined,
        loginHint: url.searchParams.get("login_hint") ?? undefined,
      })
      return redirect(authorizeUrl, headers)
    }

    if (action === "callback") {
      const { headers, next } = await idp.completeLogin(args.request, {
        redirectUri: redirectUriFor(args.request),
      })
      return redirect(next === "/" ? defaultRedirect : next, headers)
    }

    if (action === "logout") {
      const redirectTo = new URL(logoutRedirect, url.origin).toString()
      const { headers, url: endSession } = await idp.logout(args.request, {
        redirectTo,
        idpLogout: options.idpLogout,
      })
      // The local session is already gone. If there's no usable end-session URL
      // we just land the visitor back on the app; the IdP's SSO session simply
      // outlives the app's.
      return redirect(endSession ?? redirectTo, headers)
    }

    // The session as JSON, for the code that can't reach a loader: a client-only
    // route, a widget mounted outside the router, a fetch from a worker. A
    // server-rendered page should keep reading `requireSession` — this is the
    // same data one network hop later.
    if (action === "me") {
      const session = await idp.getSession(args.request)
      const headers = new Headers({
        "content-type": "application/json",
        // Per-user and revocable — never let a shared cache hold it.
        "cache-control": "no-store, private",
      })
      if (!session) {
        return new Response(JSON.stringify({ user: null }), { status: 401, headers })
      }
      // Polling this keeps a sliding session alive, same as any other request.
      const renewed = session.renewCookie()
      if (renewed) headers.append("set-cookie", renewed)
      return new Response(JSON.stringify({ user: publicSession(session) }), { status: 200, headers })
    }

    return new Response("not found", { status: 404 })
  }

  return {
    loader: (args: RouteArgs) => handle(args),
    action: (args: RouteArgs) => handle(args),
  }
}

export type GuardOptions = {
  /** Use this Idp instead of `context.idp`. */
  idp?: Idp
  /** Where `requireSession` sends anonymous visitors. Default `/auth/login`. */
  loginPath?: string
  /** Skip the `?next=` round trip. */
  preserveNext?: boolean
}

/** The session for this request, or null. Never throws for the anonymous case. */
export async function getSession(
  args: RouteArgs,
  options: GuardOptions = {},
): Promise<Session | null> {
  return resolveIdp(args, options).getSession(args.request)
}

/**
 * The session, or a redirect to login preserving where the visitor was going.
 * Throwing a `Response` is how react-router short-circuits a loader.
 */
export async function requireSession(
  args: RouteArgs,
  options: GuardOptions = {},
): Promise<Session> {
  const session = await getSession(args, options)
  if (session) return session

  const url = new URL(args.request.url)
  const loginUrl = new URL(options.loginPath ?? "/auth/login", url.origin)
  if (options.preserveNext !== false) {
    loginUrl.searchParams.set("next", `${url.pathname}${url.search}`)
  }
  throw redirect(loginUrl.toString())
}

/**
 * `requireSession` plus a permission check. A logged-out visitor is redirected
 * to log in; a logged-in one without the permission gets a 403 — re-authenticating
 * wouldn't help them.
 */
export async function requirePermission(
  args: RouteArgs,
  permission: string,
  options: GuardOptions = {},
): Promise<Session> {
  const session = await requireSession(args, options)
  if (!session.can(permission)) {
    throw new Response(`Forbidden: missing ${permission}`, { status: 403 })
  }
  return session
}

function resolveIdp(args: RouteArgs, options: GuardOptions): Idp {
  const idp = options.idp ?? (args.context as { idp?: Idp } | undefined)?.idp
  if (!idp) {
    throw new Error(
      "@willyim/idp/react-router: no Idp found. Put it on the load context as `idp`, " +
        "or pass `{ idp }` to the guard.",
    )
  }
  return idp
}

function redirect(location: string, headers?: Headers): Response {
  const merged = new Headers(headers)
  merged.set("location", location)
  return new Response(null, { status: 302, headers: merged })
}
