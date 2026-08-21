/**
 * A fake IdP behind a `fetch` you inject. No module mocking and no network:
 * every test drives the real client code against this, and asserts on the
 * request counters it keeps.
 */

import { PERMISSIONS_CLAIM, WORKSPACES_CLAIM } from "../../src/claims.js"

export type StubClaims = {
  sub: string
  email: string
  name?: string | null
  picture?: string | null
  permissions: string[]
  workspaces: { id: string; slug: string; name: string; domain: string | null; role: string }[]
  act?: { sub: string; email?: string } | null
}

export type StubIdpOptions = {
  issuer?: string
  clientId?: string
  clientSecret?: string
  claims?: Partial<StubClaims>
  /** `expires_in` on minted access tokens. null omits it. */
  expiresIn?: number | null
  /** Advertise a per-app session ceiling (seconds) in discovery. */
  sessionMaxAge?: number
  endSession?: boolean
}

const DEFAULT_CLAIMS: StubClaims = {
  sub: "user_1",
  email: "willy@willy.im",
  name: "Willy",
  picture: null,
  permissions: ["admin", "invoices:read"],
  workspaces: [
    { id: "ws_1", slug: "acme-hq", name: "Acme HQ", domain: "acme.test", role: "owner" },
  ],
  act: null,
}

export function createStubIdp(options: StubIdpOptions = {}) {
  const issuer = options.issuer ?? "https://idp.test/auth"
  const clientId = options.clientId ?? "test-client"
  const clientSecret = options.clientSecret ?? "test-secret"

  const state = {
    claims: { ...DEFAULT_CLAIMS, ...options.claims } as StubClaims,
    expiresIn: options.expiresIn === undefined ? 3600 : options.expiresIn,
    /** Pending authorization codes, keyed by code. */
    codes: new Map<string, { codeChallenge: string; redirectUri: string }>(),
    accessTokens: new Set<string>(),
    refreshTokens: new Set<string>(),
    /** Access tokens the IdP will answer 401 for, whatever their `expires_in`. */
    rejected: new Set<string>(),
    /** Flip to make every refresh fail, as a revoked grant would. */
    refreshRevoked: false,
    /** Status the next userinfo call answers with, if not 200. */
    userinfoStatus: null as number | null,
    counters: { discovery: 0, token: 0, refresh: 0, userinfo: 0, endSession: 0 },
    lastTokenRequest: null as Record<string, string> | null,
  }

  let sequence = 0
  const mint = (prefix: string) => `${prefix}_${++sequence}`

  const endpoints = {
    authorization: `${issuer}/oauth2/authorize`,
    token: `${issuer}/oauth2/token`,
    userinfo: `${issuer}/oauth2/userinfo`,
    endSession: `${issuer}/oauth2/end-session`,
  }

  function discoveryDocument() {
    return {
      issuer,
      authorization_endpoint: endpoints.authorization,
      token_endpoint: endpoints.token,
      userinfo_endpoint: endpoints.userinfo,
      jwks_uri: `${issuer}/jwks`,
      ...(options.endSession === false ? {} : { end_session_endpoint: endpoints.endSession }),
      ...(options.sessionMaxAge ? { session_max_age: options.sessionMaxAge } : {}),
    }
  }

  function issueTokens(withRefresh: boolean) {
    const accessToken = mint("at")
    state.accessTokens.add(accessToken)
    const refreshToken = withRefresh ? mint("rt") : null
    if (refreshToken) state.refreshTokens.add(refreshToken)
    return {
      access_token: accessToken,
      token_type: "Bearer",
      ...(state.expiresIn === null ? {} : { expires_in: state.expiresIn }),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      id_token: `idtok.${accessToken}`,
      scope: "openid profile email offline_access",
    }
  }

  function userinfoPayload() {
    const { claims } = state
    return {
      sub: claims.sub,
      email: claims.email,
      email_verified: true,
      name: claims.name ?? null,
      picture: claims.picture ?? null,
      ...(claims.permissions.length ? { [PERMISSIONS_CLAIM]: claims.permissions } : {}),
      ...(claims.workspaces.length ? { [WORKSPACES_CLAIM]: claims.workspaces } : {}),
      ...(claims.act ? { act: claims.act } : {}),
    }
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })

  const stubFetch: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    const path = `${url.origin}${url.pathname}`

    if (path === `${issuer}/.well-known/openid-configuration`) {
      state.counters.discovery++
      return json(discoveryDocument())
    }

    if (path === endpoints.token) {
      state.counters.token++
      const form = Object.fromEntries(new URLSearchParams(await request.text()))
      state.lastTokenRequest = form
      if (form.client_id !== clientId || form.client_secret !== clientSecret) {
        return json({ error: "invalid_client" }, 401)
      }

      if (form.grant_type === "authorization_code") {
        const pending = form.code ? state.codes.get(form.code) : undefined
        if (!pending) return json({ error: "invalid_grant" }, 400)
        state.codes.delete(form.code!)
        const challenge = await s256(form.code_verifier ?? "")
        if (challenge !== pending.codeChallenge) return json({ error: "invalid_grant" }, 400)
        if (form.redirect_uri !== pending.redirectUri) return json({ error: "invalid_grant" }, 400)
        return json(issueTokens(true))
      }

      if (form.grant_type === "refresh_token") {
        state.counters.refresh++
        if (state.refreshRevoked || !state.refreshTokens.has(form.refresh_token ?? "")) {
          return json({ error: "invalid_grant" }, 400)
        }
        state.refreshTokens.delete(form.refresh_token!)
        return json(issueTokens(true))
      }

      return json({ error: "unsupported_grant_type" }, 400)
    }

    if (path === endpoints.userinfo) {
      state.counters.userinfo++
      if (state.userinfoStatus !== null) {
        const status = state.userinfoStatus
        state.userinfoStatus = null
        return json({ error: "error" }, status)
      }
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
      if (!state.accessTokens.has(token) || state.rejected.has(token)) {
        return json({ error: "invalid_token" }, 401)
      }
      return json(userinfoPayload())
    }

    if (path === endpoints.endSession) {
      state.counters.endSession++
      return new Response(null, { status: 302 })
    }

    return json({ error: "not_found", path }, 404)
  }

  return {
    issuer,
    clientId,
    clientSecret,
    endpoints,
    fetch: stubFetch,
    counters: state.counters,
    get claims() {
      return state.claims
    },
    get lastTokenRequest() {
      return state.lastTokenRequest
    },

    /** Grant permissions as the IdP would, so the next `/userinfo` sees them. */
    setPermissions(permissions: string[]) {
      state.claims = { ...state.claims, permissions }
    },
    /** Kill every refresh token — what a revoked grant looks like from here. */
    revokeRefreshTokens() {
      state.refreshRevoked = true
    },
    /** Make the IdP reject a specific access token with 401. */
    rejectAccessToken(token: string) {
      state.rejected.add(token)
    },
    /** One-shot status override for the next `/userinfo` call. */
    failNextUserinfo(status: number) {
      state.userinfoStatus = status
    },

    /**
     * Play the user's half of the handshake: consume an authorization URL and
     * hand back the callback URL the browser would arrive at.
     */
    authorize(authorizationUrl: string): string {
      const url = new URL(authorizationUrl)
      const redirectUri = url.searchParams.get("redirect_uri")!
      const code = mint("code")
      state.codes.set(code, {
        codeChallenge: url.searchParams.get("code_challenge")!,
        redirectUri,
      })
      const callback = new URL(redirectUri)
      callback.searchParams.set("code", code)
      callback.searchParams.set("state", url.searchParams.get("state")!)
      return callback.toString()
    },
  }
}

export type StubIdp = ReturnType<typeof createStubIdp>

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  let binary = ""
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
