/**
 * Layer 0 — the OIDC relying party. Everything on the wire lives here: the
 * discovery document, the authorization-code flow with PKCE, refresh, userinfo,
 * and RP-initiated logout. No sessions, no cookies, no storage.
 *
 * `fetch` + WebCrypto only, so it runs anywhere the platform is web-standard.
 */

import { normalizeClaims, type Claims } from "./claims.js"
import { randomToken, sha256Base64url } from "./crypto.js"
import { IdpError } from "./errors.js"
import { parseWire } from "./validate.js"
import { DiscoverySchema, TokensSchema, type Discovery, type Tokens } from "./wire.js"

export { IdpError } from "./errors.js"
export type { Discovery, Tokens } from "./wire.js"

/**
 * Every scope the IdP advertises in `scopes_supported`. Typed rather than
 * `string[]` so a typo (`"offline-access"`) is a compile error instead of a
 * redirect the IdP rejects at runtime. Widen this when the IdP grows a scope.
 */
export const SUPPORTED_SCOPES = ["openid", "profile", "email", "offline_access"] as const

export type IdpScope = (typeof SUPPORTED_SCOPES)[number]

/** What `authorizationUrl` asks for when a caller says nothing. */
export const DEFAULT_SCOPES: readonly IdpScope[] = SUPPORTED_SCOPES

export type IdpClientOptions = {
  /**
   * The OIDC issuer, including the basepath the IdP is mounted on:
   * `https://idp.willy.im/auth` (or a vanity domain, `https://idp.kasso.do/auth`).
   * Discovery is `${issuer}/.well-known/openid-configuration`.
   */
  issuer: string
  clientId: string
  clientSecret: string
  /** Default scopes for `authorizationUrl`. `offline_access` buys refresh tokens. */
  scopes?: readonly IdpScope[]
  /** Override `fetch` — tests, instrumentation, a Worker's bound fetcher. */
  fetch?: typeof fetch
}

export type AuthorizationUrlInput = {
  redirectUri: string
  state: string
  /** The S256 challenge. PKCE is not optional — see `createPkce`. */
  codeChallenge: string
  scopes?: readonly IdpScope[]
  /** `login` to force re-authentication, `none` for a silent check. */
  prompt?: string
  loginHint?: string
}

export type IdpClient = ReturnType<typeof createIdpClient>

/** A fresh PKCE verifier and its S256 challenge. */
export async function createPkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomToken(32)
  return { codeVerifier, codeChallenge: await sha256Base64url(codeVerifier) }
}

export function createIdpClient(options: IdpClientOptions) {
  const issuer = options.issuer.replace(/\/+$/, "")
  const doFetch = options.fetch ?? globalThis.fetch
  const defaultScopes = options.scopes ?? DEFAULT_SCOPES
  let cached: Promise<Discovery> | null = null

  /** The discovery document, fetched at most once per client instance. */
  function discover(): Promise<Discovery> {
    cached ??= (async () => {
      const url = `${issuer}/.well-known/openid-configuration`
      let response: Response
      try {
        response = await doFetch(url)
      } catch (cause) {
        cached = null
        throw new IdpError(`discovery request to ${url} failed`, 0, cause)
      }
      if (!response.ok) {
        cached = null
        throw new IdpError(
          `discovery failed (${response.status})`,
          response.status,
          await text(response),
        )
      }
      return parseWire(DiscoverySchema, await response.json().catch(() => null), "discovery")
    })()
    return cached
  }

  async function token(body: URLSearchParams, what: string): Promise<Tokens> {
    const { token_endpoint } = await discover()
    body.set("client_id", options.clientId)
    body.set("client_secret", options.clientSecret)
    const response = await doFetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    })
    const json = await response.json().catch(() => null)
    if (!response.ok || !json) {
      throw new IdpError(`${what} failed (${response.status})`, response.status, json)
    }
    return parseWire(TokensSchema, json, what)
  }

  return {
    discover,

    /** Where to send the browser to log in. */
    async authorizationUrl(input: AuthorizationUrlInput): Promise<string> {
      const { authorization_endpoint } = await discover()
      const url = new URL(authorization_endpoint)
      url.searchParams.set("response_type", "code")
      url.searchParams.set("client_id", options.clientId)
      url.searchParams.set("redirect_uri", input.redirectUri)
      url.searchParams.set("scope", (input.scopes ?? defaultScopes).join(" "))
      url.searchParams.set("state", input.state)
      url.searchParams.set("code_challenge", input.codeChallenge)
      url.searchParams.set("code_challenge_method", "S256")
      if (input.prompt) url.searchParams.set("prompt", input.prompt)
      if (input.loginHint) url.searchParams.set("login_hint", input.loginHint)
      return url.toString()
    },

    /** Swap the callback `code` for tokens. The verifier proves we started the flow. */
    exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }) {
      return token(
        new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
        "token exchange",
      )
    },

    /** Requires `offline_access` at login. Throws `IdpError` once the grant is gone. */
    refresh(refreshToken: string) {
      return token(
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
        "refresh",
      )
    },

    /**
     * Live claims for an access token. Unlike the id_token — a login-time
     * snapshot — this reflects permissions and workspaces as they are *now*,
     * which is how a revocation at the IdP reaches the app.
     */
    async userinfo(accessToken: string): Promise<Claims> {
      const { userinfo_endpoint } = await discover()
      const response = await doFetch(userinfo_endpoint, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      })
      if (!response.ok) {
        throw new IdpError(
          `userinfo failed (${response.status})`,
          response.status,
          await text(response),
        )
      }
      return normalizeClaims(await response.json().catch(() => null))
    },

    /**
     * RP-initiated logout, built from the `end_session_endpoint` in discovery —
     * never a hardcoded path. Returns null when there is nothing usable to
     * redirect to, which is either of:
     *
     *  - the IdP advertises no `end_session_endpoint`, or
     *  - we have no `id_token` to hint with. The spec makes `id_token_hint`
     *    optional; this IdP does not — it identifies the client from the hint,
     *    verifies its signature, and reads `sid` out of it to pick the SSO
     *    session to kill. Without one the request is rejected.
     *
     * Callers must treat null as "log out locally and move on" — see
     * `createIdp().logout`, which does exactly that.
     *
     * Note the IdP-side registration this depends on: the OAuth client needs
     * `enable_end_session` set (better-auth answers 401 `invalid_client`
     * otherwise) and `redirectTo` must be listed in its
     * `post_logout_redirect_uris` (an unlisted URI is silently not redirected
     * to, leaving the visitor at the IdP).
     */
    async logoutUrl(input: {
      idToken?: string | null
      redirectTo?: string
    }): Promise<string | null> {
      const { end_session_endpoint } = await discover()
      if (!end_session_endpoint || !input.idToken) return null
      const url = new URL(end_session_endpoint)
      url.searchParams.set("id_token_hint", input.idToken)
      url.searchParams.set("client_id", options.clientId)
      if (input.redirectTo) url.searchParams.set("post_logout_redirect_uri", input.redirectTo)
      return url.toString()
    },
  }
}

function text(response: Response): Promise<string | null> {
  return response.text().catch(() => null)
}
