import { describe, expect, it } from "vitest"

import { DEFAULT_SESSION_COOKIE } from "../src/index.js"
import { createHarness, REDIRECT_URI } from "./helpers/harness.js"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe("login", () => {
  it("creates a session from the authorization-code round trip", async () => {
    const h = createHarness()
    const session = await h.login("/dashboard")

    expect(session.sub).toBe("user_1")
    expect(session.email).toBe("willy@willy.im")
    expect(session.permissions).toEqual(["admin", "invoices:read"])
    expect(session.workspaces[0]?.slug).toBe("acme-hq")
    expect(h.store.all()).toHaveLength(1)
  })

  it("keeps tokens in the row and out of the session object", async () => {
    const h = createHarness()
    const session = await h.login()
    const [row] = h.store.all()

    expect(row?.accessToken).toMatch(/^at_/)
    expect(row?.refreshToken).toMatch(/^rt_/)
    expect(row?.idToken).toBeTruthy()
    expect(JSON.stringify(session)).not.toContain("at_")
    expect(JSON.stringify(session)).not.toContain("rt_")
  })

  it("sets a signed session cookie and clears the handshake cookie", async () => {
    const h = createHarness()
    const started = await h.idp.startLogin({ redirectUri: REDIRECT_URI, next: "/dash" })
    h.jar.absorb(started.headers)
    expect(h.jar.get(`${DEFAULT_SESSION_COOKIE}_oauth`)).toBeTruthy()

    const result = await h.idp.completeLogin(h.jar.request(h.stub.authorize(started.url)), {
      redirectUri: REDIRECT_URI,
    })
    h.jar.absorb(result.headers)

    expect(result.next).toBe("/dash")
    expect(h.jar.get(`${DEFAULT_SESSION_COOKIE}_oauth`)).toBeUndefined()
    const cookie = h.jar.get(DEFAULT_SESSION_COOKIE)!
    const [id, signature] = cookie.split(".")
    expect(h.store.all()[0]?.id).toBe(id)
    expect(signature).toBeTruthy()
  })

  it("refuses a callback whose state doesn't match the handshake cookie", async () => {
    const h = createHarness()
    const started = await h.idp.startLogin({ redirectUri: REDIRECT_URI })
    h.jar.absorb(started.headers)
    const callback = new URL(h.stub.authorize(started.url))
    callback.searchParams.set("state", "attacker-chosen")

    await expect(
      h.idp.completeLogin(h.jar.request(callback.toString()), { redirectUri: REDIRECT_URI }),
    ).rejects.toMatchObject({ status: 400 })
    expect(h.store.all()).toHaveLength(0)
  })

  it("refuses a callback with no handshake cookie at all", async () => {
    const h = createHarness()
    const started = await h.idp.startLogin({ redirectUri: REDIRECT_URI })
    const callback = h.stub.authorize(started.url)

    await expect(
      h.idp.completeLogin(new Request(callback), { redirectUri: REDIRECT_URI }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it("drops an off-site ?next= rather than becoming an open redirect", async () => {
    const h = createHarness()
    const started = await h.idp.startLogin({ redirectUri: REDIRECT_URI, next: "//evil.test/x" })
    h.jar.absorb(started.headers)
    const result = await h.idp.completeLogin(h.jar.request(h.stub.authorize(started.url)), {
      redirectUri: REDIRECT_URI,
    })
    expect(result.next).toBe("/")
  })

  it("propagates an IdP error response from the callback", async () => {
    const h = createHarness()
    const started = await h.idp.startLogin({ redirectUri: REDIRECT_URI })
    h.jar.absorb(started.headers)

    await expect(
      h.idp.completeLogin(h.jar.request(`${REDIRECT_URI}?error=access_denied`), {
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe("getSession", () => {
  it("reads the row back for a valid cookie", async () => {
    const h = createHarness()
    await h.login()
    const session = await h.idp.getSession(h.request())

    expect(session?.sub).toBe("user_1")
    expect(session?.id).toBe(h.store.all()[0]?.id)
  })

  it("is null with no cookie, and never touches the store", async () => {
    const h = createHarness()
    let reads = 0
    const get = h.store.get.bind(h.store)
    h.store.get = async (id) => (reads++, get(id))

    expect(await h.idp.getSession(new Request("https://app.test/"))).toBeNull()
    expect(reads).toBe(0)
  })

  it("rejects a tampered cookie before the store is queried", async () => {
    const h = createHarness()
    await h.login()
    const real = h.jar.get(DEFAULT_SESSION_COOKIE)!
    const [id, signature] = real.split(".")

    let reads = 0
    const get = h.store.get.bind(h.store)
    h.store.get = async (i) => (reads++, get(i))

    // Same signature, different id — the classic forgery.
    h.jar.set(DEFAULT_SESSION_COOKIE, `${id}x.${signature}`)
    expect(await h.idp.getSession(h.request())).toBeNull()

    // Signature flipped.
    h.jar.set(DEFAULT_SESSION_COOKIE, `${id}.${"A".repeat(signature!.length)}`)
    expect(await h.idp.getSession(h.request())).toBeNull()

    // Garbage that isn't even shaped like a signed cookie.
    h.jar.set(DEFAULT_SESSION_COOKIE, "just-some-junk")
    expect(await h.idp.getSession(h.request())).toBeNull()

    expect(reads).toBe(0)
  })

  it("rejects a cookie signed with a different secret", async () => {
    const h = createHarness()
    await h.login()
    const other = createHarness({ session: { secret: "some-other-secret" } })
    const stolen = h.jar.get(DEFAULT_SESSION_COOKIE)!
    other.jar.set(DEFAULT_SESSION_COOKIE, stolen)

    expect(await other.idp.getSession(other.request())).toBeNull()
  })

  it("is null once the row is deleted — that browser is logged out", async () => {
    const h = createHarness()
    await h.login()
    await h.store.delete(h.store.all()[0]!.id)

    expect(await h.idp.getSession(h.request())).toBeNull()
  })

  it("is null past expiresAt, and cleans the row up", async () => {
    const h = createHarness({ session: { expiresIn: "1h", updateAge: "1h" } })
    await h.login()
    h.advance(2 * HOUR)

    expect(await h.idp.getSession(h.request())).toBeNull()
    expect(h.store.all()).toHaveLength(0)
  })
})

describe("freshness window", () => {
  it("serves cached claims without a network call inside the window", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    await h.login()
    const before = h.stub.counters.userinfo

    h.advance(4 * MINUTE)
    const session = await h.idp.getSession(h.request())

    expect(session?.sub).toBe("user_1")
    expect(h.stub.counters.userinfo).toBe(before)
  })

  it("re-reads /userinfo once the window closes", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    await h.login()
    const before = h.stub.counters.userinfo

    h.advance(6 * MINUTE)
    await h.idp.getSession(h.request())

    expect(h.stub.counters.userinfo).toBe(before + 1)
  })

  it("propagates a permission revoked at the IdP", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    const session = await h.login()
    expect(session.can("admin")).toBe(true)

    h.stub.setPermissions(["invoices:read"])

    // Still cached.
    h.advance(MINUTE)
    expect((await h.idp.getSession(h.request()))?.can("admin")).toBe(true)

    // Window closed: the liveness ping picks the change up.
    h.advance(5 * MINUTE)
    const after = await h.idp.getSession(h.request())
    expect(after?.can("admin")).toBe(false)
    expect(after?.permissions).toEqual(["invoices:read"])
    expect(h.store.all()[0]?.syncedAt).toEqual(h.now)
  })

  it("keeps serving cached claims when the IdP is down rather than logging out", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    await h.login()
    h.advance(6 * MINUTE)
    h.stub.failNextUserinfo(503)

    const session = await h.idp.getSession(h.request())
    expect(session?.can("admin")).toBe(true)
    expect(h.store.all()).toHaveLength(1)
  })
})

describe("token refresh", () => {
  it("refreshes an expired access token before re-reading claims", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    await h.login()
    const first = h.store.all()[0]!.accessToken

    h.advance(2 * HOUR) // past the stub's 1h expires_in
    const session = await h.idp.getSession(h.request())

    expect(session?.sub).toBe("user_1")
    expect(h.stub.counters.refresh).toBe(1)
    expect(h.store.all()[0]?.accessToken).not.toBe(first)
  })

  it("refreshes and retries once when /userinfo answers 401", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    await h.login()
    h.stub.rejectAccessToken(h.store.all()[0]!.accessToken)

    h.advance(6 * MINUTE)
    const session = await h.idp.getSession(h.request())

    expect(session?.sub).toBe("user_1")
    expect(h.stub.counters.refresh).toBe(1)
    expect(h.stub.counters.userinfo).toBe(3) // login, the 401, the retry
  })

  it("deletes the session when the refresh fails — the grant is gone", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    await h.login()
    h.stub.rejectAccessToken(h.store.all()[0]!.accessToken)
    h.stub.revokeRefreshTokens()

    h.advance(6 * MINUTE)
    expect(await h.idp.getSession(h.request())).toBeNull()
    expect(h.store.all()).toHaveLength(0)
  })

  it("deletes the session when an expired token can't be refreshed", async () => {
    const h = createHarness({ session: { freshness: "5m" } })
    await h.login()
    h.stub.revokeRefreshTokens()

    h.advance(2 * HOUR)
    expect(await h.idp.getSession(h.request())).toBeNull()
    expect(h.store.all()).toHaveLength(0)
  })
})

describe("sliding expiry", () => {
  it("leaves expiresAt alone inside updateAge", async () => {
    const h = createHarness({ session: { expiresIn: "7d", updateAge: "1d", freshness: "5m" } })
    await h.login()
    const original = h.store.all()[0]!.expiresAt

    h.advance(12 * HOUR)
    const session = await h.idp.getSession(h.request())

    expect(h.store.all()[0]?.expiresAt).toEqual(original)
    expect(session?.renewCookie()).toBeNull()
  })

  it("slides expiresAt and hands back a cookie to match, past updateAge", async () => {
    const h = createHarness({ session: { expiresIn: "7d", updateAge: "1d", freshness: "5m" } })
    await h.login()
    const original = h.store.all()[0]!.expiresAt

    h.advance(2 * DAY)
    const session = await h.idp.getSession(h.request())

    expect(h.store.all()[0]!.expiresAt.getTime()).toBeGreaterThan(original.getTime())
    expect(h.store.all()[0]!.expiresAt).toEqual(new Date(h.now.getTime() + 7 * DAY))
    expect(session?.renewCookie()).toContain("idp_session=")
  })

  it("never slides past absoluteExpiresIn", async () => {
    const h = createHarness({
      session: { expiresIn: "7d", updateAge: "1d", freshness: "5m", absoluteExpiresIn: "10d" },
    })
    await h.login()
    const cap = new Date(h.now.getTime() + 10 * DAY)

    h.advance(6 * DAY)
    await h.idp.getSession(h.request())
    expect(h.store.all()[0]?.expiresAt).toEqual(cap)
  })
})

describe("IdP session ceiling", () => {
  it("clamps a session longer than the IdP permits", async () => {
    const h = createHarness({
      idp: { sessionMaxAge: 86_400 },
      session: { expiresIn: "30d" },
    })
    await h.login()
    expect(h.store.all()[0]?.expiresAt).toEqual(new Date(h.now.getTime() + DAY))
  })

  it("leaves a session inside the ceiling alone", async () => {
    const h = createHarness({
      idp: { sessionMaxAge: 30 * 86_400 },
      session: { expiresIn: "7d" },
    })
    await h.login()
    expect(h.store.all()[0]?.expiresAt).toEqual(new Date(h.now.getTime() + 7 * DAY))
  })

  it("applies no clamp when the IdP advertises no ceiling", async () => {
    const h = createHarness({ session: { expiresIn: "30d" } })
    await h.login()
    expect(h.store.all()[0]?.expiresAt).toEqual(new Date(h.now.getTime() + 30 * DAY))
  })
})

describe("can()", () => {
  it("matches exactly, honours wildcards, and denies the rest", async () => {
    const h = createHarness({
      idp: { claims: { permissions: ["admin", "invoices:*"] } },
    })
    const session = await h.login()

    expect(session.can("admin")).toBe(true)
    expect(session.can("invoices:read")).toBe(true)
    expect(session.can("invoices:write")).toBe(true)
    expect(session.can("billing:read")).toBe(false)
    expect(session.can("admins")).toBe(false)
  })

  it("grants everything to a bare *", async () => {
    const h = createHarness({ idp: { claims: { permissions: ["*"] } } })
    const session = await h.login()
    expect(session.can("anything:at:all")).toBe(true)
  })
})

describe("logout", () => {
  it("deletes the row and expires the cookie", async () => {
    const h = createHarness()
    await h.login()
    const headers = await h.idp.destroySession(h.request())
    h.jar.absorb(headers)

    expect(h.store.all()).toHaveLength(0)
    expect(h.jar.get(DEFAULT_SESSION_COOKIE)).toBeUndefined()
    expect(await h.idp.getSession(h.request())).toBeNull()
  })

  it("returns the IdP end-session URL with the row's id_token", async () => {
    const h = createHarness()
    await h.login()
    const idToken = h.store.all()[0]!.idToken

    const { headers, url } = await h.idp.logout(h.request(), { redirectTo: "https://app.test/" })
    h.jar.absorb(headers)

    expect(new URL(url!).searchParams.get("id_token_hint")).toBe(idToken)
    expect(h.store.all()).toHaveLength(0)
  })

  it("still destroys the local session when the IdP offers no end-session", async () => {
    const h = createHarness({ idp: { endSession: false } })
    await h.login()

    const { headers, url } = await h.idp.logout(h.request())
    h.jar.absorb(headers)

    expect(url).toBeNull()
    expect(h.store.all()).toHaveLength(0)
    expect(await h.idp.getSession(h.request())).toBeNull()
  })

  it("destroyAllSessions logs every browser out", async () => {
    const h = createHarness()
    await h.login()
    // A second browser's session for the same subject, in the same store.
    await h.store.create({ ...h.store.all()[0]!, id: "second-session" })
    expect(h.store.all()).toHaveLength(2)

    await h.idp.destroyAllSessions("user_1")
    expect(h.store.all()).toHaveLength(0)
    expect(await h.idp.getSession(h.request())).toBeNull()
  })
})
