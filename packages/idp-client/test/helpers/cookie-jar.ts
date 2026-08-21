/**
 * The browser's half of the handshake: collect `Set-Cookie` headers and replay
 * them as a `Cookie` header, honouring `Max-Age=0` deletions.
 */

export function createCookieJar() {
  const jar = new Map<string, string>()

  return {
    /** Absorb every `Set-Cookie` on a `Headers` or a `Response`. */
    absorb(source: Headers | Response) {
      const headers = source instanceof Response ? source.headers : source
      for (const cookie of headers.getSetCookie()) {
        const [pair, ...attributes] = cookie.split(";")
        const eq = pair!.indexOf("=")
        const name = pair!.slice(0, eq).trim()
        const value = decodeURIComponent(pair!.slice(eq + 1).trim())
        const expired = attributes.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a))
        if (expired || !value) jar.delete(name)
        else jar.set(name, value)
      }
      return this
    },
    get(name: string): string | undefined {
      return jar.get(name)
    },
    set(name: string, value: string) {
      jar.set(name, value)
    },
    /** The `Cookie` request header, or "" when the jar is empty. */
    header(): string {
      return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ")
    },
    /** A `Request` for `url` carrying the current cookies. */
    request(url: string, init: RequestInit = {}): Request {
      const headers = new Headers(init.headers)
      headers.set("cookie", this.header())
      return new Request(url, { ...init, headers })
    },
  }
}
