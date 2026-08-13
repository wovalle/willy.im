/**
 * Layer 1 — the app session. The cookie holds an HMAC-signed opaque session id;
 * everything else lives in the row. The signature is checked before the store is
 * touched, so a junk cookie never costs a query.
 *
 * Permissions are a TTL-cached projection of IdP truth: inside the freshness
 * window we read the row, past it we re-read `/userinfo`. That per-freshness
 * call doubles as a liveness ping — it is how a revocation at the IdP reaches
 * the app, in minutes rather than in session-lengths.
 */

import type { Actor, Claims, Workspace } from "./claims.js"
import { grants } from "./claims.js"
import {
  createIdpClient,
  createPkce,
  IdpError,
  type IdpClient,
  type IdpClientOptions,
} from "./client.js"
import { clearCookie, readCookie, serializeCookie, type CookieOptions } from "./cookie.js"
import {
  base64urlDecodeString,
  base64urlEncodeString,
  createSigner,
  randomToken,
} from "./crypto.js"
import { parseDuration, type Duration } from "./duration.js"
import type { SessionRecord, SessionStore } from "./store.js"

export const DEFAULT_SESSION_COOKIE = "idp_session"

/** How long the login handshake may take before its state cookie is stale. */
const STATE_COOKIE_MAX_AGE_MS = 10 * 60_000

export type SessionOptions = {
  /** HMAC key for the session cookie. Rotating it logs everyone out. */
  secret: string
  /** Idle timeout. Slides on use via `updateAge`. Default `"7d"`. */
  expiresIn?: Duration
  /** Only slide the expiry once the session is this far into its life. Default `"1d"`. */
  updateAge?: Duration
  /** How long cached claims are trusted before `/userinfo` is re-read. Default `"5m"`. */
  freshness?: Duration
  /** Hard cap measured from login — no amount of sliding gets past it. */
  absoluteExpiresIn?: Duration
  cookieName?: string
  cookieDomain?: string
  /** Off only for local http development. Default true. */
  secure?: boolean
  sameSite?: "lax" | "strict" | "none"
  path?: string
}

export type IdpOptions = IdpClientOptions & {
  sessions: SessionStore
  session: SessionOptions
  /** Testing hook: the clock the session logic reads. */
  now?: () => Date
  /** Emit dev-mode warnings (clamped session length, …). Default: off in production. */
  debug?: boolean
}

/**
 * A live session. Safe to project into loader data — it carries claims, never
 * tokens. `can()` and `renewCookie()` are methods, so a plain serialization of
 * this object gives the browser exactly the data and none of the behaviour.
 */
export type Session = {
  id: string
  sub: string
  email: string
  name: string | null
  image: string | null
  permissions: string[]
  workspaces: Workspace[]
  actor: Actor | null
  createdAt: Date
  expiresAt: Date
  /** Exact match, or a `resource:*` / `*` grant that covers it. */
  can(permission: string): boolean
  /**
   * The `Set-Cookie` that extends the browser's cookie to match a session whose
   * expiry just slid, or null when nothing changed. Attach it to the response
   * if you want sliding sessions to survive the cookie's own `Max-Age`.
   */
  renewCookie(): string | null
}

export type Idp = ReturnType<typeof createIdp>

type StatePayload = { state: string; codeVerifier: string; next?: string }

export function createIdp(options: IdpOptions) {
  const client: IdpClient = createIdpClient(options)
  const store = options.sessions
  const signer = createSigner(options.session.secret)
  const now = options.now ?? (() => new Date())

  const cookieName = options.session.cookieName ?? DEFAULT_SESSION_COOKIE
  const stateCookieName = `${cookieName}_oauth`
  const cookieOptions: CookieOptions = {
    path: options.session.path ?? "/",
    domain: options.session.cookieDomain,
    httpOnly: true,
    secure: options.session.secure !== false,
    sameSite: options.session.sameSite ?? "lax",
  }

  const configuredExpiresIn = parseDuration(options.session.expiresIn ?? "7d")
  const updateAge = parseDuration(options.session.updateAge ?? "1d")
  const freshness = parseDuration(options.session.freshness ?? "5m")
  const absoluteExpiresIn = options.session.absoluteExpiresIn
    ? parseDuration(options.session.absoluteExpiresIn)
    : null

  let expiresInPromise: Promise<number> | null = null

  /**
   * The session length after the IdP's ceiling is applied. An app that declares
   * a longer session than its IdP registration permits gets the IdP's number,
   * with a warning in development. When the IdP advertises no ceiling — it does
   * not yet — the configured value stands.
   */
  function resolveExpiresIn(): Promise<number> {
    expiresInPromise ??= client
      .discover()
      .then((discovery) => {
        const ceiling = discovery.session_max_age
        if (typeof ceiling !== "number" || ceiling <= 0) return configuredExpiresIn
        const ceilingMs = ceiling * 1000
        if (configuredExpiresIn <= ceilingMs) return configuredExpiresIn
        warn(
          `session.expiresIn (${configuredExpiresIn}ms) exceeds the ceiling this app is ` +
            `registered for at ${options.issuer} (${ceilingMs}ms) and was clamped. ` +
            `Raise the per-app session ceiling in the IdP console to lift it.`,
        )
        return ceilingMs
      })
      .catch(() => configuredExpiresIn)
    return expiresInPromise
  }

  function warn(message: string): void {
    // Read `process` off globalThis rather than as a bare identifier: core is
    // built without node types and must load on runtimes that have no `process`.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env
    const production = env?.NODE_ENV === "production"
    if (options.debug === false || (options.debug === undefined && production)) return
    console.warn(`[@willyim/idp] ${message}`)
  }

  function sessionCookie(id: string, maxAgeMs: number): string {
    return serializeCookie(cookieName, id, { ...cookieOptions, maxAge: maxAgeMs / 1000 })
  }

  /** Signed cookie -> session id, or null. Nothing here touches the store. */
  async function readSessionId(request: Request): Promise<string | null> {
    const signed = readCookie(request, cookieName)
    if (!signed) return null
    return signer.unsign(signed)
  }

  function toSession(row: SessionRecord, renewed: string | null): Session {
    return {
      id: row.id,
      sub: row.sub,
      email: row.email,
      name: row.name,
      image: row.image,
      permissions: row.permissions,
      workspaces: row.workspaces,
      actor: row.actor,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      can: (permission) => grants(row.permissions, permission),
      renewCookie: () => renewed,
    }
  }

  function claimPatch(claims: Claims): Partial<SessionRecord> {
    return {
      email: claims.email || undefined,
      name: claims.name,
      image: claims.image,
      permissions: claims.permissions,
      workspaces: claims.workspaces,
      actor: claims.actor,
    }
  }

  function tokenPatch(tokens: {
    accessToken: string
    refreshToken: string | null
    idToken: string | null
    expiresIn: number | null
  }): Partial<SessionRecord> {
    return {
      accessToken: tokens.accessToken,
      // A rotating IdP returns a new refresh token; a non-rotating one returns
      // none, and the old one stays valid.
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
      accessTokenExpiresAt: expiryOf(tokens.expiresIn),
    }
  }

  function expiryOf(expiresIn: number | null): Date | null {
    return expiresIn === null ? null : new Date(now().getTime() + expiresIn * 1000)
  }

  /**
   * Re-read claims from the IdP. A 401 means the access token died early, so we
   * refresh and retry exactly once. A failed refresh means the grant is gone —
   * revoked, expired, or the user was deleted — and the row goes with it.
   */
  async function sync(row: SessionRecord): Promise<SessionRecord | null> {
    let patch: Partial<SessionRecord> = {}
    let accessToken = row.accessToken
    let refreshToken = row.refreshToken
    let refreshed = false

    const doRefresh = async (): Promise<boolean> => {
      if (!refreshToken) return false
      try {
        const tokens = await client.refresh(refreshToken)
        patch = { ...patch, ...tokenPatch(tokens) }
        accessToken = tokens.accessToken
        refreshToken = tokens.refreshToken ?? refreshToken
        refreshed = true
        return true
      } catch {
        return false
      }
    }

    const expired = row.accessTokenExpiresAt !== null && row.accessTokenExpiresAt <= now()
    if (expired && !(await doRefresh())) {
      await store.delete(row.id)
      return null
    }

    let claims: Claims
    try {
      claims = await client.userinfo(accessToken)
    } catch (error) {
      if (!isUnauthorized(error)) {
        // The IdP is unreachable or broken. Serving slightly stale claims beats
        // logging the world out over someone else's outage; `syncedAt` is left
        // alone so the next request tries again.
        return refreshed ? ((await store.update(row.id, patch)) ?? row) : row
      }
      if (refreshed || !(await doRefresh())) {
        await store.delete(row.id)
        return null
      }
      try {
        claims = await client.userinfo(accessToken)
      } catch (retryError) {
        if (!isUnauthorized(retryError)) return (await store.update(row.id, patch)) ?? row
        await store.delete(row.id)
        return null
      }
    }

    return store.update(row.id, { ...patch, ...claimPatch(claims), syncedAt: now() })
  }

  /**
   * Slide the idle timeout, but only once the session is `updateAge` into its
   * life — otherwise every request would write. `absoluteExpiresIn` caps it.
   */
  async function slide(row: SessionRecord): Promise<{ row: SessionRecord; cookie: string | null }> {
    const expiresIn = await resolveExpiresIn()
    const current = now()
    if (row.expiresAt.getTime() - current.getTime() > expiresIn - updateAge) {
      return { row, cookie: null }
    }
    let expiresAt = new Date(current.getTime() + expiresIn)
    if (absoluteExpiresIn) {
      const cap = new Date(row.createdAt.getTime() + absoluteExpiresIn)
      if (cap < expiresAt) expiresAt = cap
    }
    if (expiresAt <= row.expiresAt) return { row, cookie: null }
    const updated = (await store.update(row.id, { expiresAt })) ?? { ...row, expiresAt }
    return {
      row: updated,
      cookie: sessionCookie(await signedId(row.id), expiresAt.getTime() - current.getTime()),
    }
  }

  function signedId(id: string): Promise<string> {
    return signer.pack(id)
  }

  async function destroySession(request: Request): Promise<Headers> {
    const id = await readSessionId(request)
    if (id) await store.delete(id)
    const headers = new Headers()
    headers.append("set-cookie", clearCookie(cookieName, cookieOptions))
    headers.append("set-cookie", clearCookie(stateCookieName, cookieOptions))
    return headers
  }

  return {
    /** The Layer 0 client, for anything the session layer doesn't wrap. */
    client,

    /**
     * Step one of login: where to send the browser, plus the `Set-Cookie` that
     * carries the CSRF state and the PKCE verifier through the round trip.
     */
    async startLogin(input: {
      redirectUri: string
      /** Path to return to after the callback. Only same-site paths are honoured. */
      next?: string
      prompt?: string
      loginHint?: string
    }): Promise<{ url: string; headers: Headers }> {
      const { codeVerifier, codeChallenge } = await createPkce()
      const state = randomToken(16)
      const url = await client.authorizationUrl({
        redirectUri: input.redirectUri,
        state,
        codeChallenge,
        prompt: input.prompt,
        loginHint: input.loginHint,
      })
      const payload: StatePayload = { state, codeVerifier, next: safeNext(input.next) }
      const headers = new Headers()
      headers.append(
        "set-cookie",
        serializeCookie(
          stateCookieName,
          await signer.pack(base64urlEncodeString(JSON.stringify(payload))),
          { ...cookieOptions, maxAge: STATE_COOKIE_MAX_AGE_MS / 1000 },
        ),
      )
      return { url, headers }
    },

    /**
     * Step two: verify the state, exchange the code, read live claims, and write
     * the session row. Returns the `Set-Cookie` headers and where to go next.
     */
    async completeLogin(
      request: Request,
      input: { redirectUri: string },
    ): Promise<{ session: Session; headers: Headers; next: string }> {
      const url = new URL(request.url)
      const error = url.searchParams.get("error")
      if (error) {
        throw new IdpError(
          `authorization failed: ${url.searchParams.get("error_description") ?? error}`,
          400,
          error,
        )
      }
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      if (!code || !state) throw new IdpError("callback is missing code or state", 400)

      const signed = readCookie(request, stateCookieName)
      const raw = signed ? await signer.unsign(signed) : null
      if (!raw) throw new IdpError("login state cookie is missing or invalid", 400)
      let payload: StatePayload
      try {
        payload = JSON.parse(base64urlDecodeString(raw)) as StatePayload
      } catch {
        throw new IdpError("login state cookie is malformed", 400)
      }
      if (payload.state !== state) throw new IdpError("state mismatch", 400)

      const tokens = await client.exchangeCode({
        code,
        redirectUri: input.redirectUri,
        codeVerifier: payload.codeVerifier,
      })
      const claims = await client.userinfo(tokens.accessToken)

      const created = now()
      const expiresIn = await resolveExpiresIn()
      let expiresAt = new Date(created.getTime() + expiresIn)
      if (absoluteExpiresIn) {
        const cap = new Date(created.getTime() + absoluteExpiresIn)
        if (cap < expiresAt) expiresAt = cap
      }
      const id = randomToken(32)
      const row = await store.create({
        id,
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        image: claims.image,
        permissions: claims.permissions,
        workspaces: claims.workspaces,
        actor: claims.actor,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        idToken: tokens.idToken,
        accessTokenExpiresAt: expiryOf(tokens.expiresIn),
        syncedAt: created,
        expiresAt,
        createdAt: created,
      })

      const headers = new Headers()
      headers.append(
        "set-cookie",
        sessionCookie(await signedId(id), expiresAt.getTime() - created.getTime()),
      )
      headers.append("set-cookie", clearCookie(stateCookieName, cookieOptions))
      return { session: toSession(row, null), headers, next: payload.next ?? "/" }
    },

    /**
     * The session for this request, or null. One store read on the common path;
     * a `/userinfo` round trip once the freshness window has closed.
     */
    async getSession(request: Request): Promise<Session | null> {
      const id = await readSessionId(request)
      if (!id) return null

      let row = await store.get(id)
      if (!row) return null
      if (row.expiresAt <= now()) {
        await store.delete(row.id)
        return null
      }

      const stale = now().getTime() - row.syncedAt.getTime() >= freshness
      const tokenExpired = row.accessTokenExpiresAt !== null && row.accessTokenExpiresAt <= now()
      if (stale || tokenExpired) {
        const synced = await sync(row)
        if (!synced) return null
        row = synced
      }

      const slid = await slide(row)
      return toSession(slid.row, slid.cookie)
    },

    /**
     * Log this browser out: delete the row, expire the cookie. The returned
     * headers also clear any half-finished login state.
     */
    destroySession,

    /** Log a subject out of every browser. Instant — revocation is a row delete. */
    async destroyAllSessions(sub: string): Promise<void> {
      await store.deleteBySub(sub)
    },

    /**
     * Log out locally *and* at the IdP. The row is deleted and the cookie
     * expired before anything else happens, so however the RP-initiated logout
     * goes — endpoint missing, client not registered for it, IdP down — the
     * visitor is never left signed in here.
     *
     * `url` is the IdP's end-session URL to send the browser to, or null when
     * there isn't a usable one; redirect somewhere local in that case.
     */
    async logout(
      request: Request,
      input: { redirectTo?: string; idpLogout?: boolean } = {},
    ): Promise<{ headers: Headers; url: string | null }> {
      const id = await readSessionId(request)
      const row = id ? await store.get(id) : null
      const headers = await destroySession(request)
      if (input.idpLogout === false) return { headers, url: null }
      const url = await client
        .logoutUrl({ idToken: row?.idToken, redirectTo: input.redirectTo })
        .catch(() => null)
      return { headers, url }
    },
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof IdpError && (error.status === 401 || error.status === 403)
}

/** Only same-site paths survive as `?next=` — an open redirect is not a feature. */
export function safeNext(next: string | null | undefined): string | undefined {
  if (!next) return undefined
  if (!next.startsWith("/") || next.startsWith("//")) return undefined
  return next
}
