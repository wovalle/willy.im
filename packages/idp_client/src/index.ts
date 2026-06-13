/**
 * @willyim/idp-client — talk to the willy.im IdP from a consumer app.
 *
 * Zero dependencies, web standards only (fetch + WebCrypto), so it runs on
 * Cloudflare Workers, Node ≥20, Bun, and the browser. Designed to be vendored
 * as a single file until published.
 *
 * Two halves:
 *  - OIDC relying party: authorization-code flow against the IdP, typed
 *    claims (workspaces, product permissions, `act` impersonation marker).
 *  - Management API: end-user API keys (mint/list/revoke/validate) using the
 *    app's scoped `wim_` management key.
 */

const WORKSPACES_CLAIM = "https://willy.im/workspaces"
const PERMISSIONS_CLAIM = "https://willy.im/permissions"

export type IdpWorkspace = {
  id: string
  slug: string
  name: string
  /** Hostname this workspace is served on (multi-domain apps), or null. */
  domain: string | null
  role: string
}

/** RFC 8693 actor — present while an IdP admin is impersonating the user. */
export type IdpActor = { sub: string; email?: string }

export type IdpClaims = {
  sub: string
  email?: string
  name?: string
  email_verified?: boolean
  /** Workspaces the user belongs to in THIS app. */
  workspaces: IdpWorkspace[]
  /** Product permissions granted to the user in THIS app. */
  permissions: string[]
  /** Set while an admin is impersonating this user — log it, don't act on it. */
  act: IdpActor | null
}

export type IdpTokens = {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
  scope?: string
}

export type UserApiKeyValidation =
  | { valid: true; keyId: string; userId: string; workspaceId: string | null; scopes: string[]; name: string }
  | { valid: false; reason: "not_found" | "revoked" | "expired" }

export type UserApiKeySummary = {
  id: string
  userId: string
  workspaceId: string | null
  name: string
  prefix: string
  scopes: string[]
  status: "active" | "expired" | "revoked"
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

export type IdpClientOptions = {
  /** IdP origin, e.g. "https://idp.willy.im" (or a vanity domain like "https://idp.kasso.do"). */
  issuer: string
  /** OAuth client credentials from the IdP admin console. */
  clientId: string
  clientSecret: string
  /**
   * The app key (oauth_client.metadata.app, e.g. "invoices"). Required for the
   * management-API half (user keys); optional if you only do login.
   */
  app?: string
  /** Scoped `wim_` management key. Required for the user-key methods. */
  managementKey?: string
  /** Override fetch (tests, instrumentation). */
  fetch?: typeof fetch
}

type DiscoveryDoc = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad
  return atob(b64)
}

/** Random base64url string (state, PKCE verifier). */
function randomString(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  let bin = ""
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  let bin = ""
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function normalizeClaims(payload: Record<string, unknown>): IdpClaims {
  const workspaces = Array.isArray(payload[WORKSPACES_CLAIM])
    ? (payload[WORKSPACES_CLAIM] as Record<string, unknown>[]).map((w) => ({
        id: String(w.id ?? ""),
        slug: String(w.slug ?? ""),
        name: String(w.name ?? ""),
        domain: typeof w.domain === "string" && w.domain ? w.domain : null,
        role: String(w.role ?? "member"),
      }))
    : []
  const permissions = Array.isArray(payload[PERMISSIONS_CLAIM])
    ? (payload[PERMISSIONS_CLAIM] as unknown[]).map(String)
    : []
  const act =
    payload.act && typeof payload.act === "object" && "sub" in (payload.act as object)
      ? (payload.act as IdpActor)
      : null
  return {
    sub: String(payload.sub ?? ""),
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    email_verified:
      typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
    workspaces,
    permissions,
    act,
  }
}

export class IdpError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = "IdpError"
    this.status = status
    this.body = body
  }
}

export function createIdpClient(opts: IdpClientOptions) {
  const issuer = opts.issuer.replace(/\/$/, "")
  const doFetch = opts.fetch ?? fetch
  let discovery: Promise<DiscoveryDoc> | null = null

  function discover(): Promise<DiscoveryDoc> {
    discovery ??= doFetch(`${issuer}/.well-known/openid-configuration`).then(async (r) => {
      if (!r.ok) throw new IdpError("discovery failed", r.status, await r.text())
      return (await r.json()) as DiscoveryDoc
    })
    return discovery
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    if (!opts.managementKey) throw new Error("managementKey is required for management API calls")
    const res = await doFetch(`${issuer}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${opts.managementKey}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new IdpError(`IdP API ${res.status}`, res.status, body)
    return body as T
  }

  function requireApp(): string {
    if (!opts.app) throw new Error("`app` is required for management API calls")
    return opts.app
  }

  return {
    /**
     * Build the login redirect. Returns the URL plus the state + PKCE verifier
     * you must persist (cookie) and hand back to exchangeCode.
     */
    async authorizationUrl(input: {
      redirectUri: string
      scope?: string
      prompt?: string
    }): Promise<{ url: string; state: string; codeVerifier: string }> {
      const d = await discover()
      const state = randomString(16)
      const codeVerifier = randomString(32)
      const url = new URL(d.authorization_endpoint)
      url.searchParams.set("response_type", "code")
      url.searchParams.set("client_id", opts.clientId)
      url.searchParams.set("redirect_uri", input.redirectUri)
      url.searchParams.set("scope", input.scope ?? "openid profile email")
      url.searchParams.set("state", state)
      url.searchParams.set("code_challenge", await sha256b64url(codeVerifier))
      url.searchParams.set("code_challenge_method", "S256")
      if (input.prompt) url.searchParams.set("prompt", input.prompt)
      return { url: url.toString(), state, codeVerifier }
    },

    /**
     * Exchange the callback code for tokens. Claims are decoded from the
     * id_token — it just arrived over TLS directly from the token endpoint
     * authenticated with the client secret, so per OIDC core the signature
     * check is optional here. (Verify via JWKS if you pass tokens around.)
     */
    async exchangeCode(input: {
      code: string
      redirectUri: string
      codeVerifier?: string
    }): Promise<{ tokens: IdpTokens; claims: IdpClaims | null }> {
      const d = await discover()
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      })
      const res = await doFetch(d.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      })
      const json = (await res.json().catch(() => null)) as IdpTokens | null
      if (!res.ok || !json) throw new IdpError("token exchange failed", res.status, json)
      return { tokens: json, claims: json.id_token ? this.decodeIdToken(json.id_token) : null }
    },

    /** Refresh an access token (requires the offline_access scope at login). */
    async refresh(refreshToken: string): Promise<IdpTokens> {
      const d = await discover()
      const res = await doFetch(d.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
        }),
      })
      const json = (await res.json().catch(() => null)) as IdpTokens | null
      if (!res.ok || !json) throw new IdpError("refresh failed", res.status, json)
      return json
    },

    /**
     * Live claims for an access token. Unlike the id_token (a login-time
     * snapshot), this reflects CURRENT workspaces/permissions and — key for
     * audit — whether an admin is impersonating the user right now.
     */
    async userinfo(accessToken: string): Promise<IdpClaims> {
      const d = await discover()
      const res = await doFetch(d.userinfo_endpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok || !json) throw new IdpError("userinfo failed", res.status, json)
      return normalizeClaims(json)
    },

    /** Decode an id_token's payload into typed claims. Validates iss/aud/exp. */
    decodeIdToken(idToken: string): IdpClaims {
      const parts = idToken.split(".")
      if (parts.length !== 3) throw new Error("malformed id_token")
      const payload = JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
      if (!aud.includes(opts.clientId)) throw new Error("id_token aud mismatch")
      if (typeof payload.iss === "string" && !payload.iss.startsWith(issuer)) {
        throw new Error("id_token iss mismatch")
      }
      if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
        throw new Error("id_token expired")
      }
      return normalizeClaims(payload)
    },

    /** The workspace served on `host` (multi-domain apps), else null. */
    workspaceForHost(claims: IdpClaims, host: string): IdpWorkspace | null {
      const h = host.toLowerCase().split(":")[0]
      return claims.workspaces.find((w) => w.domain === h) ?? null
    },

    hasPermission(claims: IdpClaims, permission: string): boolean {
      return claims.permissions.includes(permission)
    },

    /** The impersonating admin, if any — tag your audit logs with this. */
    impersonator(claims: IdpClaims): IdpActor | null {
      return claims.act
    },

    /** End-user API keys for this app's own API, stored + validated by the IdP. */
    userKeys: {
      /** Mint a key for one of your users. `token` is returned exactly once. */
      create(input: {
        userId: string
        name: string
        scopes?: string[]
        workspaceId?: string
        expiresAt?: string
      }): Promise<{ id: string; token: string; prefix: string }> {
        return api(`/api/v1/apps/${requireApp()}/user-keys`, {
          method: "POST",
          body: JSON.stringify(input),
        })
      },
      async list(filter?: { userId?: string; workspaceId?: string }): Promise<UserApiKeySummary[]> {
        const q = new URLSearchParams()
        if (filter?.userId) q.set("userId", filter.userId)
        if (filter?.workspaceId) q.set("workspaceId", filter.workspaceId)
        const qs = q.size ? `?${q}` : ""
        const res = await api<{ keys: UserApiKeySummary[] }>(
          `/api/v1/apps/${requireApp()}/user-keys${qs}`,
        )
        return res.keys
      },
      revoke(id: string): Promise<{ ok: true }> {
        return api(`/api/v1/apps/${requireApp()}/user-keys/${id}`, { method: "DELETE" })
      },
      /** Validate a key presented to YOUR API. Cache positive hits briefly. */
      validate(token: string): Promise<UserApiKeyValidation> {
        return api(`/api/v1/apps/${requireApp()}/user-keys/validate`, {
          method: "POST",
          body: JSON.stringify({ token }),
        })
      },
    },
  }
}

export type IdpClient = ReturnType<typeof createIdpClient>
