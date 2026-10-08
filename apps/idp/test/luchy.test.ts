import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { serverEventName } from "luchy/react-router"

import type { AuthService } from "../app/lib/auth.server"
import { LUCHY_TRACKER_OPTIONS, luchyIdentity } from "../app/lib/luchy.server"
import { bearerRequest, bootstrapAdminKey, createApplication, mintApiKey } from "./helpers/fixtures"
import { createTestHarness, routerContext, type TestHarness } from "./helpers/harness"

/**
 * The generic derivation mechanics are tested inside the `luchy` package.
 * These tests pin the IdP's configuration of it: what our knobs actually
 * produce for our routes.
 */
describe("IdP tracker configuration", () => {
  const name = (input: Parameters<typeof serverEventName>[0]) =>
    serverEventName(input, LUCHY_TRACKER_OPTIONS)

  it("names console mutations route:intent", () => {
    expect(
      name({
        method: "POST",
        pathname: "/apps/kasso.data",
        status: 200,
        intent: "invite-member",
      }),
    ).toBe("apps/kasso:invite-member")
  })

  it("suffixes intent-less API mutations with the method", () => {
    expect(name({ method: "POST", pathname: "/api/admin_keys.revoke", status: 200 })).toBe(
      "api/admin_keys.revoke:post",
    )
    expect(name({ method: "POST", pathname: "/apps/kasso/api/members.invite", status: 200 })).toBe(
      "apps/kasso/api/members.invite:post",
    )
  })

  it("tracks auth verbs, including failures", () => {
    expect(name({ method: "POST", pathname: "/auth/sign-in/email-otp", status: 200 })).toBe(
      "auth/sign-in/email-otp:post",
    )
    expect(name({ method: "POST", pathname: "/auth/sign-in/email-otp", status: 401 })).toBe(
      "auth/sign-in/email-otp:post",
    )
  })

  it("drops key-validation plumbing for every app key", () => {
    expect(
      name({ method: "POST", pathname: "/apps/luchy/api/user_keys.validate", status: 200 }),
    ).toBeNull()
    expect(
      name({ method: "POST", pathname: "/apps/kasso/api/user_keys.validate", status: 200 }),
    ).toBeNull()
  })

  it("still ignores reads and the manifest", () => {
    expect(name({ method: "GET", pathname: "/applications", status: 200 })).toBeNull()
    expect(name({ method: "POST", pathname: "/__manifest", status: 200 })).toBeNull()
  })
})

describe("luchyIdentity", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  type StubSession = {
    user: { id: string; name: string; email: string; role?: string }
    session: { impersonatedBy?: string | null }
  }
  const identify = (request: Request, session: StubSession | null = null) => {
    const auth = { api: { getSession: async () => session } } as unknown as AuthService
    return luchyIdentity({ request, context: routerContext({ ...h.ctx, services: { auth } }) })
  }
  const cookieRequest = new Request("https://idp.willy.im/", {
    headers: { cookie: "better-auth.session_token=abc" },
  })
  const ana = { id: "usr_ana", name: "Ana", email: "ana@willy.im" }

  it("is anonymous without a session", async () => {
    expect(await identify(new Request("https://idp.willy.im/"))).toBeUndefined()
    expect(await identify(cookieRequest, null)).toBeUndefined()
  })

  it("identifies the signed-in user with name and email traits", async () => {
    expect(await identify(cookieRequest, { user: ana, session: {} })).toEqual({
      user: "usr_ana",
      actor: undefined,
      props: undefined,
      traits: { name: "Ana", email: "ana@willy.im" },
    })
  })

  it("names the impersonator as actor", async () => {
    const identity = await identify(cookieRequest, {
      user: { ...ana, role: "user" },
      session: { impersonatedBy: "usr_admin" },
    })
    expect(identity?.user).toBe("usr_ana")
    expect(identity?.actor).toBe("usr_admin")
  })

  it("flags IdP admins in props", async () => {
    const identity = await identify(cookieRequest, { user: { ...ana, role: "admin" }, session: {} })
    expect(identity?.props).toEqual({ admin: true })
  })

  it("identifies bearer keys by their audit label, with kind and app", async () => {
    const root = await bootstrapAdminKey(h.ctx)
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
    const key = await mintApiKey(h.ctx, { app: "acme" }, root.principal)

    expect(await identify(bearerRequest(root.token))).toEqual({
      user: `adminkey:${root.id}`,
      props: { kind: "superadmin" },
    })
    expect(await identify(bearerRequest(key.token))).toEqual({
      user: `apikey:${key.id}`,
      props: { kind: "key", app: "acme" },
    })
    expect(await identify(bearerRequest("wim_nope"))).toBeUndefined()
  })
})
