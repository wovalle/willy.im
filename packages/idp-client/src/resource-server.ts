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
 *      the permissions claim                                → `verify()`
 *
 * Step 4 is the only one with any code in it, and it is deliberately small:
 * signature (EdDSA, ES256 or RS256 via WebCrypto — no jose, no deps), issuer,
 * audience, time. The permissions on the token were computed by the IdP for
 * the app that owns this resource (the same way a browser session's are), so
 * the app does not look anything up — it reads a claim and matches it with
 * `grants()` like everywhere else.
 *
 * The JWKS is cached and refetched once on an unknown `kid`, which is how a
 * key rotation at the IdP is picked up without a restart.
 */

import { grants } from "./claims.js"
import { IdpError } from "./errors.js"

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
  /** The app the permissions are for (the owner of `resource`),