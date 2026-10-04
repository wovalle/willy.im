/**
 * Opaque credentials the IdP issues — management keys (`wim_`), end-user keys
 * (`wak_`), app tokens (`wat_`): a random token shown once, stored only as its
 * SHA-256.
 */

// Bytes of entropy in the random part of a token.
const TOKEN_BYTES = 32

/** base64url without padding — URL/header safe, no `+` `/` `=`. */
function base64url(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** A fresh opaque token, e.g. `wim_X8f...`. */
export function generateToken(prefix = "wim_"): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return prefix + base64url(bytes)
}

/** SHA-256(token) as lowercase hex. The stored lookup key. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
