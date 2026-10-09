/**
 * The OIDC authorize request, carried through /login and /consent.
 *
 * When /auth/oauth2/authorize needs the user (to sign in, or to consent) it
 * redirects here with the authorize params plus a signature (`sig`) that
 * expires (`exp`, codeExpiresIn: 10 minutes). The oauth-provider client plugin
 * attaches that query to every POST the page makes, and the server rejects the
 * whole request with `400 invalid_signature` once `exp` has passed — so a
 * sign-in page left open past that could not sign anyone in, by any method.
 *
 * An expired request is not resumed: the client's own half of the handshake
 * (its `state` and PKCE verifier) is just as stale by then, and the person may
 * not even want that app any more. The page drops the query and becomes a
 * plain sign-in; the app is where they start over.
 */

/** Treat the query as expired this long before `exp`, so a request in flight doesn't cross it. */
const EXPIRY_MARGIN_MS = 30_000

/** Our own params on /login; everything else on the URL belongs to the authorize request. */
const LOGIN_PARAMS = ["email", "next"]

/** Whether `search` carries a signed authorize query that has expired (or is about to). */
export function signedQueryExpired(search: string | URLSearchParams, now = Date.now()): boolean {
  const params = new URLSearchParams(search)
  if (!params.has("sig")) return false
  const exp = Number(params.get("exp"))
  return !Number.isFinite(exp) || exp * 1000 - EXPIRY_MARGIN_MS <= now
}

/** `search` without the authorize request: `?email=…&next=…`, or "" when neither is set. */
export function withoutSignedQuery(search: string | URLSearchParams): string {
  const params = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const [key, value] of params) if (LOGIN_PARAMS.includes(key)) kept.append(key, value)
  const query = kept.toString()
  return query ? `?${query}` : ""
}

/**
 * Drops an expired authorize query from the current URL, so the client plugin
 * stops attaching it. True when it did. Plain `history.replaceState` (keeping
 * React Router's state): a router navigation would land after the auth request
 * that needs the clean URL.
 */
export function dropExpiredSignedQuery(): boolean {
  if (!signedQueryExpired(window.location.search)) return false
  const url = window.location.pathname + withoutSignedQuery(window.location.search)
  window.history.replaceState(window.history.state, "", url)
  return true
}
