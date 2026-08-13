import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { AuthService } from "../app/lib/auth.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import { getAppAccess, requireAppPermission } from "../app/lib/security.server"
import { createApplication, createMember, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * App access from a console session. The only thing `getAppAccess` needs from
 * the auth service is `api.getSession`, so we hand it a stub rather than boot
 * Better Auth — the logic under test is the membership + permission resolution.
 */
function authStub(user: { id: string; email: string } | null): AuthService {
  return {
    api: { getSession: async () => (user ? { user, session: {} } : null) },
  } as unknown as AuthService
}

const request = new Request("https://idp.willy.im/app/acme")

describe("getAppAccess", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
  })
  afterEach(() => h.close())

  it("returns null when nobody is signed in", async () => {
    expect(await getAppAccess(request, h.ctx, authStub(null), "acme")).toBeNull()
  })

  it("gives an IdP superadmin everything, on every app, without membership", async () => {
    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })

    const access = await getAppAccess(request, h.ctx, authStub(superadmin), "acme")
    expect(access!.isSuperadmin).toBe(true)
    expect(access!.role).toBe("admin")
    expect(access!.permissions).toEqual([...APP_PERMISSIONS])
    expect(access!.can("app:delete")).toBe(true)

    const other = await getAppAccess(request, h.ctx, authStub(superadmin), "never-heard-of-it")
    expect(other!.can("app:delete")).toBe(true)
  })

  it("gives an app admin the whole management catalog for that app", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })

    const access = await getAppAccess(request, h.ctx, authStub(boss), "acme")
    expect(access!.isSuperadmin).toBe(false)
    expect(access!.role).toBe("admin")
    expect(access!.permissions).toEqual([...APP_PERMISSIONS])
  })

  it("gives a member exactly their granted permissions", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      permissions: ["member:read", "audit:read"],
    })

    const access = await getAppAccess(request, h.ctx, authStub(user), "acme")
    expect(access!.role).toBe("member")
    expect(access!.permissions).toEqual(["member:read", "audit:read"])
    expect(access!.can("member:read")).toBe(true)
    expect(access!.can("member:manage")).toBe(false)
  })

  it("gives a member with no grants no permissions", async () => {
    const user = await createUser(h.ctx, { email: "bare@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member" })

    const access = await getAppAccess(request, h.ctx, authStub(user), "acme")
    expect(access!.role).toBe("member")
    expect(access!.permissions).toEqual([])
    expect(access!.can("app:read")).toBe(false)
  })

  it("reports a signed-in non-member as having no access at all", async () => {
    const stranger = await createUser(h.ctx, { email: "stranger@elsewhere.test" })

    const access = await getAppAccess(request, h.ctx, authStub(stranger), "acme")
    expect(access!.role).toBeNull()
    expect(access!.permissions).toEqual([])
    expect(access!.can("app:read")).toBe(false)
  })

  it("does not carry an admin of one app into another", async () => {
    const boss = await createUser(h.ctx, { email: "boss@other.test" })
    await createApplication(h.ctx, { app: "other" })
    await createMember(h.ctx, { app: "other", userId: boss.id, role: "admin" })

    const access = await getAppAccess(request, h.ctx, authStub(boss), "acme")
    expect(access!.role).toBeNull()
  })
})

describe("requireAppPermission", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    await createApplication(h.ctx, { app: "acme" })
  })
  afterEach(() => h.close())

  const statusOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      return 200
    } catch (thrown) {
      if (thrown instanceof Response) return thrown.status
      throw thrown
    }
  }

  it("403s an anonymous caller", async () => {
    expect(
      await statusOf(() => requireAppPermission(request, h.ctx, authStub(null), "acme", "app:read")),
    ).toBe(403)
  })

  it("403s a member without the permission", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member", permissions: ["app:read"] })

    expect(
      await statusOf(() =>
        requireAppPermission(request, h.ctx, authStub(user), "acme", "app:delete"),
      ),
    ).toBe(403)
  })

  it("passes a member holding the permission", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member", permissions: ["app:read"] })

    const access = await requireAppPermission(request, h.ctx, authStub(user), "acme", "app:read")
    expect(access.role).toBe("member")
  })
})
