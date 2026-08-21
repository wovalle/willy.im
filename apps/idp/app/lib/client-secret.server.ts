/**
 * Client-secret hashing and credential generation for OAuth clients.
 *
 * The oauth-provider plugin can create clients itself, but only from an
 * endpoint that demands a cookie session — which locks application creation to
 * a browser. We register clients with a direct insert instead, so we need the
 * *same* hasher the plugin verifies with, otherwise every previously-stored
 * secret would stop matching.
 *
 * `hashClientSecret` is byte-identical to the plugin's `defaultHasher`
 * (SHA-256 -> base64url, no padding). We hand it back to the plugin via
 * `storeClientSecret: { hash: hashClientSecret }`, so there is exactly one
 * implementation on both sides of the fence and the four clients already in
 * production keep verifying.
 */

/** base64url without padding — the plugin's `base64Url.encode(…, {padding:false})`. */
function base64UrlNoPad(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Hashes an OAuth client secret for storage.
 *
 * SHA-256 of the UTF-8 bytes, base64url-encoded without padding. Do not
 * "improve" this: it is a wire format shared with @better-auth/oauth-provider
 * and with every secret already sitting in `oauth_client.client_secret`.
 */
export async function hashClientSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))
  return base64UrlNoPad(new Uint8Array(digest))
}

// The plugin mints both credentials with `generateRandomString(32, "a-z", "A-Z")`.
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
const LENGTH = 32

/**
 * 32 characters drawn uniformly from `[a-zA-Z]`. Rejection sampling rather than
 * plain modulo, so the 52-letter alphabet isn't biased towards its first
 * letters (256 % 52 != 0).
 */
function randomAlpha(): string {
  const limit = 256 - (256 % ALPHABET.length)
  let out = ""
  while (out.length < LENGTH) {
    const bytes = new Uint8Array(LENGTH)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= limit) continue
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === LENGTH) break
    }
  }
  return out
}

/** A fresh `client_id`, same shape as the plugin's. */
export function generateClientId(): string {
  return randomAlpha()
}

/** A fresh plaintext `client_secret`, same shape as the plugin's. */
export function generateClientSecret(): string {
  return randomAlpha()
}
