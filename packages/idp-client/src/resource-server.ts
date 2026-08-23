/**
 * Being an OAuth 2.1 resource server against the willy.im IdP — which is what
 * an MCP server is.
 *
 * The MCP authorization spec is plain OAuth with three discovery hops, and
 * every one of them is either served by the IdP already or is a static
 * document this module writes for you:
 *
 *   1. The client hits the resource without a token and gets a 401 carrying
 *      `WWW-Authenticate: Bearer resource_metadata="…"`   → `challenge()`
 *   2. It fetches that URL, the Protected Resource Metadata (RFC 9728), which
 *      names the authorization server                       → `metadata()`
 *   3. It fetches the AS metadata (RFC 8414) from the IdP, registers itself
 *      (RFC 7591), runs authorization code + PKCE with `resource=` (RFC 8707),
 *      and comes back with a JWT access token whose `aud` is this resource.
 *   4. The resource server verifies that JWT against the IdP's JWKS and reads
 *      the permissions claim                                → `authenticate()`
 *
 * Step 4 is the only one with any real code, and it is deliberately small:
 * signature (EdDSA/Ed25519, ES256 or RS256 via WebCrypto — no jose, no deps),
 * issuer, audience, time. The permissions on the token were computed by the
 * IdP for the app that owns this resource (the same way a browser session's
 * are), so the app looks nothing up — it reads a claim and matches it with
 * `grants()` like everywhere else.
 *
 * The JWKS is cached and refetched once on an unknown `kid`, which is how a key
 * rotation at the IdP is picked up without a restart.
 */

import { grants } from "./claims.js"

export const PERMISSIONS_CLAIM = "https://willy.im/permissions"
export const APP_CLAIM = "https://willy.im/app"

export type ResourceServerOptions = {
  /** The IdP's OAuth issuer — `https://idp.willy.im/auth` (note the /auth). */
  issuer: string
  /**
   * This server's canonical URI, exactly as registered on the application in
   * the IdP (`resources`) — e.g. `https://bender.romo.fyi/mcp`. It is the
   * audience a token must carry, compared byte for byte.
   */
  resource: string
  /** Defaults to `${issuer}/jwks`. */
  jwksUrl?: string
  /** Advertised in the metadata document. Informational only. */
  scopesSupported?: string[]
  /** How long a fetched JWKS is reused. Default 10 minutes. */
  jwksTtlMs?: number
  /** Clock skew tolerated on exp/nbf. Default 60s. */
  leewaySeconds?: number
  fetch?: typeof fetch
  /** Clock seam, for tests. */
  now?: () => number
}

/** A verified access token, reduced to what an app acts on. */
export type VerifiedAccessToken = {
  /** The IdP user id — the same `sub` a session or a wak_ key resolves to. */
  sub: string
  /** The app the permissions are for (the owner of `resource`), when present. */
  app: string | null
  /** The user's product permissions for that app. Match with `has()`/`grants()`. */
  permissions: string[]
  /** Space-delimited OAuth scopes on the token (openid/profile/…), if any. */
  scopes: string[]
  /** Everything else on the token, for a caller that needs a raw claim. */
  claims: Record<string, unknown>
}

export type AuthResult =
  | { ok: true; token: VerifiedAccessToken }
  | { ok: false; status: 401 | 403; error: string; description: string }

const DEFAULT_JWKS_TTL_MS = 600_000
const DEFAULT_LEEWAY_S = 60

type Jwk = {
  kid?: string
  kty: string
  crv?: string
  alg?: string
  x?: string
  y?: string
  n?: string
  e?: string
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)))
}

/** The WebCrypto import + verify params for the algorithms the IdP may sign with. */
function algParams(
  alg: string,
  jwk: Jwk,
): { importAlg: EcKeyImportParams | RsaHashedImportParams | Algorithm; verifyAlg: AlgorithmIdentifier | EcdsaParams | RsaPssParams } | null {
  switch (alg) {
    case "EdDSA":
      return { importAlg: { name: "Ed25519" }, verifyAlg: { name: "Ed25519" } }
    case "ES256":
      return { importAlg: { name: "ECDSA", namedCurve: "P-256" }, verifyAlg: { name: "ECDSA", hash: "SHA-256" } }
    case "RS256":
      return {
        importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        verifyAlg: { name: "RSASSA-PKCS1-v1_5" },
      }
    default:
      return jwk.kty ? null : null
  }
}

export function createResourceServer(options: ResourceServerOptions) {
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? (() => Date.now())
  const jwksUrl = options.jwksUrl ?? `${options.issuer.replace(/\/$/, "")}/jwks`
  const jwksTtlMs = options.jwksTtlMs ?? DEFAULT_JWKS_TTL_MS
  const leeway = (options.leewaySeconds ?? DEFAULT_LEEWAY_S) * 1000

  let jwks: { at: number; keys: Jwk[] } | null = null

  async function loadJwks(force: boolean): Promise<Jwk[]> {
    if (!force && jwks && now() - jwks.at < jwksTtlMs) return jwks.keys
    const res = await doFetch(jwksUrl)
    if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`)
    const body = (await res.json()) as { keys?: Jwk[] }
    jwks = { at: now(), keys: body.keys ?? [] }
    return jwks.keys
  }

  /** Find the signing key by kid, refetching ONCE on a miss to catch rotation. */
  async function keyFor(kid: string | undefined): Promise<Jwk | null> {
    const pick = (keys: Jwk[]) => keys.find((k) => (kid ? k.kid === kid : true)) ?? null
    let key = pick(await loadJwks(false))
    if (!key) key = pick(await loadJwks(true))
    return key
  }

  async function verifySignature(
    header: { alg: string; kid?: string },
    signingInput: string,
    signature: Uint8Array,
  ): Promise<boolean> {
    const jwk = await keyFor(header.kid)
    if (!jwk) return false
    const params = algParams(header.alg, jwk)
    if (!params) return false
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, params.importAlg as never, false, ["verify"])
    return crypto.subtle.verify(
      params.verifyAlg as never,
      key,
      signature as unknown as BufferSource,
      new TextEncoder().encode(signingInput) as unknown as BufferSource,
    )
  }

  /**
   * Verifies a raw bearer token. Returns a discriminated result rather than
   * throwing, so the caller owns the response shape. `insufficient_scope` is a
   * 403; everything about the token being absent or bad is a 401.
   */
  async function verify(token: string): Promise<AuthResult> {
    const parts = token.split(".")
    if (parts.length !== 3) {
      return { ok: false, status: 401, error: "invalid_token", description: "Not a JWT." }
    }
    let header: { alg: string; kid?: string }
    let claims: Record<string, unknown>
    try {
      header = decodeJson(parts[0]!) as { alg: string; kid?: string }
      claims = decodeJson(parts[1]!)
    } catch {
      return { ok: false, status: 401, error: "invalid_token", description: "Malformed JWT." }
    }

    let valid = false
    try {
      valid = await verifySignature(header, `${parts[0]}.${parts[1]}`, b64urlToBytes(parts[2]!))
    } catch {
      valid = false
    }
    if (!valid) {
      return { ok: false, status: 401, error: "invalid_token", description: "Bad signature." }
    }

    if (claims.iss !== options.issuer) {
      return { ok: false, status: 401, error: "invalid_token", description: "Wrong issuer." }
    }
    const aud = claims.aud
    const audOk = Array.isArray(aud) ? aud.includes(options.resource) : aud === options.resource
    if (!audOk) {
      return { ok: false, status: 401, error: "invalid_token", description: "Token is for a different resource." }
    }
    const t = now()
    if (typeof claims.exp === "number" && t > claims.exp * 1000 + leeway) {
      return { ok: false, status: 401, error: "invalid_token", description: "Token expired." }
    }
    if (typeof claims.nbf === "number" && t < claims.nbf * 1000 - leeway) {
      return { ok: false, status: 401, error: "invalid_token", description: "Token not yet valid." }
    }

    const permissions = Array.isArray(claims[PERMISSIONS_CLAIM])
      ? (claims[PERMISSIONS_CLAIM] as unknown[]).filter((p): p is string => typeof p === "string")
      : []
    const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : []
    return {
      ok: true,
      token: {
        sub: String(claims.sub ?? ""),
        app: typeof claims[APP_CLAIM] === "string" ? (claims[APP_CLAIM] as string) : null,
        permissions,
        scopes,
        claims,
      },
    }
  }

  /**
   * The whole check off a `Request`: pull the bearer, verify it, and confirm
   * every required permission (wildcard-aware via `grants()`). Returns a
   * result rather than throwing.
   */
  async function authenticate(
    request: { headers: { get(name: string): string | null } },
    init: { permissions?: string[] } = {},
  ): Promise<AuthResult> {
    const authz = request.headers.get("authorization")
    const bearer = authz && /^Bearer\s+(.+)$/i.exec(authz.trim())?.[1]
    if (!bearer) {
      return { ok: false, status: 401, error: "invalid_token", description: "No bearer token." }
    }
    const verified = await verify(bearer.trim())
    if (!verified.ok) return verified
    const missing = (init.permissions ?? []).filter((p) => !grants(verified.token.permissions, p))
    if (missing.length) {
      return {
        ok: false,
        status: 403,
        error: "insufficient_scope",
        description: `Missing permission(s): ${missing.join(", ")}.`,
      }
    }
    return verified
  }

  /**
   * The `WWW-Authenticate` value for a 401, pointing a client at the metadata
   * document so it can discover how to get a token (RFC 9728 §5.1).
   */
  function challenge(error?: { error: string; description: string }): string {
    const parts = [
      `Bearer resource_metadata="${options.resource}/.well-known/oauth-protected-resource"`,
    ]
    if (error) parts.push(`error="${error.error}"`, `error_description="${error.description}"`)
    return parts.join(", ")
  }

  /**
   * The Protected Resource Metadata document (RFC 9728) — served at
   * `/.well-known/oauth-protected-resource`. It names this resource and the
   * IdP as its authorization server; the client takes it from there.
   */
  function metadata(): Record<string, unknown> {
    return {
      resource: options.resource,
      authorization_servers: [options.issuer],
      bearer_methods_supported: ["header"],
      ...(options.scopesSupported ? { scopes_supported: options.scopesSupported } : {}),
    }
  }

  return { verify, authenticate, challenge, metadata }
}

export type ResourceServer = ReturnType<typeof createResourceServer>
