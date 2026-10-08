/**
 * The OIDC authorize request, carried through /login and /consent.
 *
 * When /auth/oauth2/authorize needs the user (to sign in, or to consent) it
 * redirects here with the original authorize params plus a signature: `sig`,
 * `exp` (codeExpiresIn, 10 minutes), `ba_iat`, `ba_param` (the signed names) and
 * maybe `ba_pl`. The oauth-provider client plugin attaches that query to every
 * POST the page makes, and the server rejects the whole request with
 * `400 invalid_signature` once `exp` has passed — so a sign-in page left open
 * for ten minutes can no longer sign anyone in, by any method.
 *
 * The signature only proves the params came from us; the params themselves are
 * the authorize request. Replaying them against /auth/oauth2/authorize starts
 * the same request over with a fresh signature.
 */

const SIGNATURE_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"]

/** Treat the query as stale this long before `exp`, so a request in flight doesn't cross it. */
const EXPIRY_MARGIN_MS = 30_000

/**
 * The authorize URL that restarts the flow, when `search` carries a signed
 * authorize query that has expired (or is about to). `null` when there is no
 * signed query, or it is still good.
 */
export function staleAuthorizeUrl(search: string | URLSearchParams, now = Date.now()): string | null {
  const params = new URLSearchParams(search)
  if (!params.has("sig")) return null
  const exp = Number(params.get("exp"))
  if (Number.isFinite(exp) && exp * 1000 - EXPIRY_MARGIN_MS > now) return null

  // Only what was signed is the authorize request; anything else on the URL
  // (`email`, `next`, …) was added by us and means nothing to /authorize.
  const signed = new Set(params.getAll("ba_param"))
  const authorize = new URLSearchParams()
  for (const [key, value] of params) {
    if (SIGNATURE_PARAMS.includes(key)) continue
    if (signed.size > 0 && !signed.has(key)) continue
    authorize.append(key, value)
  }
  return `/auth/oauth2/authorize?${authorize}`
}
