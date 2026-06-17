/** A redirect URI must be an absolute, parseable URL (http/https or a custom scheme). */
export function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    // http(s) needs a host; custom schemes (e.g. com.app://callback) don't.
    if (u.protocol === "http:" || u.protocol === "https:") return !!u.hostname
    return !!u.protocol
  } catch {
    return false
  }
}

/** Splits a textarea/input of space/comma/newline-separated URIs into a clean list. */
export function parseUriList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Returns the first invalid redirect URI, or null if all are valid. */
export function firstInvalidRedirectUri(uris: string[]): string | null {
  return uris.find((u) => !isValidRedirectUri(u)) ?? null
}
