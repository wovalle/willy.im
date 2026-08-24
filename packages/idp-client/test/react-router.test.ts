import { describe, expect, it } from "vitest"

import {
  createAuthRoute,
  getSession,
  requirePermission,
  requireSession,
} from "../src/react-router/index.js"
import { createHarness, type Harness } from "./helpers/harness.js"

/**
 * The adapter's whole job is turning the session layer into `Response`s, so the
 * tests drive its loader exactly the way react-router would.
 */
function routeFor(h: Harness, options: Parameters<typeof createAuthRoute>[1] = {}) {
  const { loader } = createAuthRoute(() => h.idp, options)
  return (path: string, init?: RequestInit) => loader({ request: h.request(path, init) })
}

async function loginThrough(h: Harness) {
  const route = routeFor(h)
  const start = await route("/auth/login?next=/dashboard")
  h.jar.absorb(start)
  const callback = h.stub.authorize(start.headers.get("location")!)
  const done = await route(new URL(callback).pathname + new URL(callback).search)
  h.jar.absorb(done)
  return done
}

describe("createAuthRoute", () => {
  it("/auth/login redirects to the IdP and plants the handshake cookie", async () => {
    const h = createHarness()
    const response = await routeFor(h)("/auth/login?next=/dashboard")

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("location")!)
    expect(`${location.origin}${location.pathname}`).toBe(h.stub.endpoints.authorization)
    expect(location.searchParams.get("redirect_uri")).toBe("https://app.test/auth/callback")
    expect(location.searchParams.get("code_challenge_method")).toBe("S256")
    expect(response.headers.getSetCookie().join()).toContain("idp_session_oauth=")
  })

  it("/auth/callback creates the session and returns to ?next=", async () => {
    const h = createHarness()
    const response = await loginThrough(h)

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/dashboard")
    expect(h.store.all()).toHaveLength(1)
    expect(await h.idp.getSession(h.request())).not.toBeNull()
  })

  it("/auth/callback falls back to the default redirect with no ?next=", async () => {
    const h = createHarness()
    const route = routeFor(h, { defaultRedirect: "/home" })
    const start = await route("/auth/login")
    h.jar.absorb(start)
    const callback = new URL(h.stub.authorize(start.headers.get("location")!))
    const done = await route(callback.pathname + callback.search)

    expect(done.headers.get("location")).toBe("/home")
  })

  it("/auth/logout ends the local session and the IdP's", async () => {
    const h = createHarness()
    await loginThrough(h)

    const response = await routeFor(h)("/auth/logout")
    h.jar.absorb(response)

    expect(h.store.all()).toHaveLength(0)
    const location = new URL(response.headers.get("location")!)
    expect(`${location.origin}${location.pathname}`).toBe(h.stub.endpoints.endSession)
    expect(location.searchParams.get("id_token_hint")).toBeTruthy()
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe("https://app.test/")
  })

  it("/auth/logout still lands locally when the IdP can't end the session", async () => {
    const h = createHarness({ idp: { endSession: false } })
    await loginThrough(h)

    const response = await routeFor(h)("/auth/logout")
    h.jar.absorb(response)

    expect(response.headers.get("location")).toBe("https://app.test/")
    expect(h.store.all()).toHaveLength(0)
    expect(await h.idp.getSession(h.request())).toBeNull()
  })

  it("/auth/logout honours idpLogout: false", async () => {
    const h = createHarness()
    await loginThrough(h)

    const response = await routeFor(h, { idpLogout: false })("/auth/logout")
    expect(response.headers.get("location")).toBe("https://app.test/")
    expect(h.store.all()).toHaveLength(0)
  })

  it("404s on anything else under the splat", async () => {
    const h = createHarness()
    expect((await routeFor(h)("/auth/whatever")).status).toBe(404)
  })

  it("/auth/me hands the browser the session — and nothing it shouldn't have", async () => {
    const h = createHarness({ idp: { claims: { picture: "https://idp.test/avatar/user_1" } } })
    const session = await h.login()

    const response = await routeFor(h)("/auth/me")
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store, private")

    const { user } = (await response.json()) as { user: Record<string, unknown> }
    expect(user).toMatchObject({
      sub: session.sub,
      email: session.email,
      name: "Willy",
      image: "https://idp.test/avatar/user_1",
      permissions: session.permissions,
      expiresAt: session.expiresAt.toISOString(),
    })
    // The session id is the thing the signed cookie resolves to; script never needs it.
    expect(user).not.toHaveProperty("id")
    expect(user).not.toHaveProperty("can")
    expect(user).not.toHaveProperty("renewCookie")
  })

  it("/auth/me is a 401 with an explicit null for a logged-out visitor", async () => {
    const h = createHarness()
    const response = await routeFor(h)("/auth/me")

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ user: null })
  })
})

describe("guards", () => {
  it("requireSession redirects an anonymous visitor, preserving where they were going", async () => {
    const h = createHarness()
    const args = { request: h.request("/invoices?page=2"), context: { idp: h.idp } }

    const thrown = await requireSession(args).catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(Response)
    const location = new URL((thrown as Response).headers.get("location")!)
    expect(location.pathname).toBe("/auth/login")
    expect(location.searchParams.get("next")).toBe("/invoices?page=2")
  })

  it("requireSession returns the session for a logged-in visitor", async () => {
    const h = createHarness()
    await h.login()
    const session = await requireSession({
      request: h.request("/invoices"),
      context: { idp: h.idp },
    })
    expect(session.sub).toBe("user_1")
  })

  it("requirePermission 403s a logged-in visitor who lacks it", async () => {
    const h = createHarness({ idp: { claims: { permissions: ["invoices:read"] } } })
    await h.login()
    const args = { request: h.request("/admin"), context: { idp: h.idp } }

    await expect(requirePermission(args, "invoices:read")).resolves.toMatchObject({
      sub: "user_1",
    })
    const thrown = await requirePermission(args, "admin").catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(Response)
    expect((thrown as Response).status).toBe(403)
  })

  it("getSession is null rather than throwing when nobody is logged in", async () => {
    const h = createHarness()
    expect(await getSession({ request: h.request("/"), context: { idp: h.idp } })).toBeNull()
  })

  it("explains itself when the Idp isn't on the load context", async () => {
    const h = createHarness()
    await expect(getSession({ request: h.request("/"), context: {} })).rejects.toThrow(
      /no Idp found/,
    )
  })
})
