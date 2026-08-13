/**
 * Minimal cookie serialize/parse. `Request`/`Response` give us the headers but
 * not the codec, and pulling in a cookie library would break the zero-runtime-
 * dependency rule for a dozen lines.
 */

export type CookieOptions = {
  path?: string
  domain?: string
  maxAge?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: "lax" | "strict" | "none"
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? "/"}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  if (options.httpOnly !== false) parts.push("HttpOnly")
  if (options.secure !== false) parts.push("Secure")
  parts.push(`SameSite=${sameSiteLabel(options.sameSite ?? "lax")}`)
  return parts.join("; ")
}

/** A `Set-Cookie` that expires the cookie immediately. */
export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, "", { ...options, maxAge: 0 })
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=")
    if (eq < 0) continue
    const name = pair.slice(0, eq).trim()
    if (!name || name in out) continue
    try {
      out[name] = decodeURIComponent(pair.slice(eq + 1).trim())
    } catch {
      // A cookie we can't decode is a cookie we didn't write.
    }
  }
  return out
}

export function readCookie(request: Request, name: string): string | null {
  return parseCookies(request.headers.get("cookie"))[name] ?? null
}

function sameSiteLabel(value: "lax" | "strict" | "none"): string {
  return value === "lax" ? "Lax" : value === "strict" ? "Strict" : "None"
}
