/**
 * One stubbed IdP + one in-memory session store + one `createIdp`, on a clock
 * the test moves by hand. `login()` runs the real authorization-code round trip
 * through the real code, so everything downstream starts from a genuine session.
 */

import { createIdp, memorySessions, type Session, type SessionOptions } from "../../src/index.js"
import { createCookieJar } from "./cookie-jar.js"
import { createStubIdp, type StubIdpOptions } from "./stub-idp.js"

export const APP_ORIGIN = "https://app.test"
export const REDIRECT_URI = `${APP_ORIGIN}/auth/callback`

export type HarnessOptions = {
  idp?: StubIdpOptions
  session?: Partial<SessionOptions>
  start?: Date
}

export function createHarness(options: HarnessOptions = {}) {
  const stub = createStubIdp(options.idp)
  const store = memorySessions()
  const jar = createCookieJar()
  let clock = options.start ?? new Date("2026-06-01T00:00:00Z")

  const idp = createIdp({
    issuer: stub.issuer,
    clientId: stub.clientId,
    clientSecret: stub.clientSecret,
    fetch: stub.fetch,
    sessions: store,
    session: { secret: "test-session-secret", secure: false, ...options.session },
    now: () => clock,
    debug: false,
  })

  return {
    stub,
    store,
    jar,
    idp,
    get now() {
      return clock
    },
    /** Move the clock forward. Every session decision reads it. */
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms)
    },
    /** A request to `path` carrying the jar's cookies. */
    request(path = "/", init?: RequestInit) {
      return jar.request(new URL(path, APP_ORIGIN).toString(), init)
    },
    /** The full login handshake. Leaves the session cookie in the jar. */
    async login(next?: string): Promise<Session> {
      const started = await idp.startLogin({ redirectUri: REDIRECT_URI, next })
      jar.absorb(started.headers)
      const callbackUrl = stub.authorize(started.url)
      const result = await idp.completeLogin(jar.request(callbackUrl), {
        redirectUri: REDIRECT_URI,
      })
      jar.absorb(result.headers)
      return result.session
    },
  }
}

export type Harness = ReturnType<typeof createHarness>
