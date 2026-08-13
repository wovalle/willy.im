/**
 * The WebCrypto bits the package needs: random ids, the PKCE challenge, and the
 * HMAC that signs the session cookie. Everything here is web-standard so the
 * same code runs on Workers, Node ≥20, Bun and the browser.
 */

const encoder = new TextEncoder()

export function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64urlEncodeString(value: string): string {
  return base64url(encoder.encode(value))
}

export function base64urlDecodeString(value: string): string {
  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4))
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Cryptographically random base64url string — session ids, state, PKCE verifiers. */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return base64url(buffer)
}

/** The S256 PKCE challenge for a verifier. */
export async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input))
  return base64url(new Uint8Array(digest))
}

/**
 * Length-independent, content-constant-time string comparison. Both arguments
 * are base64url HMACs of a fixed length in practice, so the early length exit
 * leaks nothing an attacker doesn't already know.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type Signer = {
  sign(value: string): Promise<string>
  /** `value.signature` if the signature checks out, else null. */
  unsign(signed: string): Promise<string | null>
  /** `${value}.${signature}` */
  pack(value: string): Promise<string>
}

/**
 * HMAC-SHA256 over a string, with the imported key memoized per signer. Used to
 * sign the opaque session id so a forged or tampered cookie is rejected before
 * the session store is ever touched.
 */
export function createSigner(secret: string): Signer {
  if (!secret) throw new Error("session.secret is required")
  let key: Promise<CryptoKey> | null = null
  const getKey = () =>
    (key ??= crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ))

  async function sign(value: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", await getKey(), encoder.encode(value))
    return base64url(new Uint8Array(signature))
  }

  return {
    sign,
    pack: async (value) => `${value}.${await sign(value)}`,
    async unsign(signed) {
      const dot = signed.lastIndexOf(".")
      if (dot <= 0) return null
      const value = signed.slice(0, dot)
      const signature = signed.slice(dot + 1)
      if (!signature) return null
      return timingSafeEqual(await sign(value), signature) ? value : null
    },
  }
}
