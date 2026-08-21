import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as schema from "../app/db/schema"
import { revokeAdminKey, revokeApiKey } from "../app/lib/api-keys.server"
import type { AuthService } from "../app/lib/auth.server"
import {
  authorize,
  requireApiCaller,
  requireConsoleCaller,
  resolveCaller,
  type Caller,
} from "../app/lib/caller.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import {
  bearerRequest,
  createApplication,
  createMember,
  createUser,
  mintAdminKey,
  mintApiKey,
  tokenSuperadmin,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * The caller resolver + the gates built on it. All the resolver needs from the
 * auth service is `api.getSession`, so it gets a stub rather than a booted
 * Better Auth — what's under test is precedence, permission resolution and the
 * shape of the failures.
 */
function authStub(user: { id: string; email: string } | null): AuthService {
  return {
    api: { getSession: async () => (user ? { user, session: {} } : null) },
  } as unknown as AuthService
}

const consoleRequest = new Request("https://idp.willy.im/apps/acme")

/** The gates throw Responses; unwrap them for readable assertions. */
async function thrown(fn: () => Promise<unknown>): Promise<Response | null> {
  try {
    await fn()
    return null
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }
}

const ADMIN_TOKEN = "super-secret-admin-token"

describe("resolveCaller", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness({
      env: { ADMIN_EMAILS: "super@willy.im", ADMIN_API_TOKEN: ADMIN_TOKEN },
    })
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
  })
  afterEach(() => h.close())

  const mint = (overrides: Partial<Parameters<typeof mintApiKey>[1]> = {}) =>
    mintApiKey(h.ctx, { app: "acme", permissions: ["member:read", "member:invite"], ...overrides })

  it("returns null when there is neither a bearer token nor a session", async () => {
    expect(await resolveCaller(consoleRequest, h.ctx, authStub(null))).toBeNull()
  })

  it("resolves the static admin token to a superadmin with no human identity", async () => {
    const caller = await resolveCaller(bearerRequest(ADMIN_TOKEN), h.ctx, authStub(null))

    expect(caller!.kind).toBe("superadmin")
    expect(caller!.via).toBe("token")
    expect(caller!.userId).toBeNull()
    expect(caller!.email).toBeNull()
    expect(caller!.keyId).toBeNull()
    expect(caller!.applicationId).toBeNull()
    expect(caller!.actor).toEqual({ userId: null, label: "superadmin-token" })
    expect(await caller!.can("literally-anything", "app:delete")).toBe(true)
  })

  it("prefers the bearer token over the session cookie", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })

    const caller = await resolveCaller(bearerRequest(ADMIN_TOKEN), h.ctx, authStub(user))
    expect(caller!.kind).toBe("superadmin")
    expect(caller!.via).toBe("token")
  })

  it("refuses a bad bearer instead of falling through to a valid cookie", async () => {
    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })

    // Presenting a token means "judge me as this token" — inheriting session
    // authority from the cookie would be a privilege escalation.
    expect(await resolveCaller(bearerRequest("wim_nope"), h.ctx, authStub(superadmin))).toBeNull()
    expect(
      await resolveCaller(bearerRequest("not-even-ours"), h.ctx, authStub(superadmin)),
    ).toBeNull()
  })

  it("resolves an allowlisted session email to a superadmin who is still a person", async () => {
    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })

    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(superadmin))
    expect(caller!.kind).toBe("superadmin")
    expect(caller!.via).toBe("session")
    expect(caller!.userId).toBe(superadmin.id)
    expect(caller!.email).toBe("super@willy.im")
    expect(caller!.actor).toEqual({ userId: superadmin.id, label: `user:${superadmin.id}` })
    expect(await caller!.can("acme", "app:delete")).toBe(true)
    expect(await caller!.permissionsFor("acme")).toEqual([...APP_PERMISSIONS])
    // No membership needed, on any app.
    expect(await caller!.can("never-heard-of-it", "app:delete")).toBe(true)
  })

  it("gives an app admin the whole management catalog for that app", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })

    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(boss))
    expect(caller!.kind).toBe("user")
    expect(caller!.via).toBe("session")
    expect(await caller!.permissionsFor("acme")).toEqual([...APP_PERMISSIONS])
  })

  it("gives a member exactly their granted permissions", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      permissions: ["member:read", "audit:read"],
    })

    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(user))
    expect(await caller!.permissionsFor("acme")).toEqual(["member:read", "audit:read"])
    expect(await caller!.can("acme", "member:read")).toBe(true)
    expect(await caller!.can("acme", "member:manage")).toBe(false)
  })

  it("gives a member with no grants no permissions", async () => {
    const user = await createUser(h.ctx, { email: "bare@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member" })

    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(user))
    expect(await caller!.permissionsFor("acme")).toEqual([])
    expect(await caller!.can("acme", "app:read")).toBe(false)
  })

  it("gives a signed-in non-member nothing at all", async () => {
    const stranger = await createUser(h.ctx, { email: "stranger@elsewhere.test" })

    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(stranger))
    expect(caller!.kind).toBe("user")
    expect(await caller!.permissionsFor("acme")).toEqual([])
    expect(await caller!.can("acme", "app:read")).toBe(false)
  })

  it("does not carry an admin of one app into another", async () => {
    const boss = await createUser(h.ctx, { email: "boss@other.test" })
    await createApplication(h.ctx, { app: "other" })
    await createMember(h.ctx, { app: "other", userId: boss.id, role: "admin" })

    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(boss))
    expect(await caller!.can("other", "app:delete")).toBe(true)
    expect(await caller!.can("acme", "app:read")).toBe(false)
  })

  it("looks a member's row up once per app, however many permissions are checked", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      permissions: ["member:read"],
    })
    await createApplication(h.ctx, { app: "other" })

    const caller = (await resolveCaller(consoleRequest, h.ctx, authStub(user))) as Caller
    const select = vi.spyOn(h.ctx.db, "select")

    await caller.can("acme", "member:read")
    await caller.can("acme", "member:manage")
    await caller.permissionsFor("acme")
    expect(select).toHaveBeenCalledTimes(1)

    await caller.can("other", "member:read")
    expect(select).toHaveBeenCalledTimes(2)
    select.mockRestore()
  })

  it("resolves a scoped key to an app-bound caller", async () => {
    const { token, id } = await mint()

    const caller = await resolveCaller(bearerRequest(token), h.ctx, authStub(null))
    expect(caller!.kind).toBe("key")
    expect(caller!.via).toBe("token")
    expect(caller!.keyId).toBe(id)
    expect(caller!.applicationId).toBe("acme")
    expect(caller!.userId).toBeNull()
    expect(caller!.actor).toEqual({ userId: null, label: `apikey:${id}` })
    expect(await caller!.can("acme", "member:read")).toBe(true)
    expect(await caller!.can("acme", "app:delete")).toBe(false)
    // App-bound: the same permission against another app is a no.
    expect(await caller!.can("other", "member:read")).toBe(false)
    expect(await caller!.permissionsFor("acme")).toEqual(["member:read", "member:invite"])
    expect(await caller!.permissionsFor("other")).toEqual([])
  })

  it("refuses a revoked key", async () => {
    const { token, id } = await mint()
    await revokeApiKey(h.ctx, tokenSuperadmin(), { app: "acme", id })
    expect(await resolveCaller(bearerRequest(token), h.ctx, authStub(null))).toBeNull()
  })

  it("refuses an expired key", async () => {
    const { token } = await mint({ expiresAt: new Date(Date.now() - 1000) })
    expect(await resolveCaller(bearerRequest(token), h.ctx, authStub(null))).toBeNull()
  })

  it("resolves an unscoped key to a superadmin that the audit log can name", async () => {
    const { token, id } = await mintAdminKey(h.ctx, { name: "Agent alpha" })

    const caller = await resolveCaller(bearerRequest(token), h.ctx, authStub(null))
    expect(caller!.kind).toBe("superadmin")
    expect(caller!.via).toBe("token")
    expect(caller!.keyId).toBe(id)
    expect(caller!.applicationId).toBeNull()
    expect(caller!.userId).toBeNull()
    expect(caller!.email).toBeNull()
    // The whole difference from the static token: a name in the trail.
    expect(caller!.actor).toEqual({ userId: null, label: `adminkey:${id}` })
    expect(await caller!.can("literally-anything", "app:delete")).toBe(true)
    expect(await caller!.permissionsFor("literally-anything")).toEqual([...APP_PERMISSIONS])
  })

  it("bumps lastUsedAt on an admin key too", async () => {
    const { token, id } = await mintAdminKey(h.ctx)
    await resolveCaller(bearerRequest(token), h.ctx, authStub(null))

    const [row] = await h.ctx.db
      .select({ lastUsedAt: schema.apiKey.lastUsedAt })
      .from(schema.apiKey)
      .where(eq(schema.apiKey.id, id))
    expect(row.lastUsedAt).toBeInstanceOf(Date)
  })

  it("refuses a revoked admin key", async () => {
    const { token, id } = await mintAdminKey(h.ctx)
    await revokeAdminKey(h.ctx, tokenSuperadmin(), id)
    expect(await resolveCaller(bearerRequest(token), h.ctx, authStub(null))).toBeNull()
  })

  it("refuses an expired admin key", async () => {
    const { token } = await mintAdminKey(h.ctx, { expiresAt: new Date(Date.now() - 1000) })
    expect(await resolveCaller(bearerRequest(token), h.ctx, authStub(null))).toBeNull()
  })
})

describe("authorize", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness({
      env: { ADMIN_EMAILS: "super@willy.im", ADMIN_API_TOKEN: ADMIN_TOKEN },
    })
    await createApplication(h.ctx, { app: "acme" })
  })
  afterEach(() => h.close())

  it("reports no caller as unauthenticated, whatever is required", async () => {
    expect(await authorize(null)).toBe("unauthenticated")
    expect(await authorize(null, { superadmin: true })).toBe("unauthenticated")
    expect(await authorize(null, { app: "acme", permission: "app:read" })).toBe("unauthenticated")
  })

  it("passes any caller when nothing is required", async () => {
    const stranger = await createUser(h.ctx, { email: "stranger@elsewhere.test" })
    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(stranger))
    expect(await authorize(caller)).toBe("ok")
  })

  it("reserves superadmin needs for superadmins", async () => {
    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    const key = await mintApiKey(h.ctx, { app: "acme", permissions: [...APP_PERMISSIONS] })

    const need = { superadmin: true } as const
    const bySession = await resolveCaller(consoleRequest, h.ctx, authStub(superadmin))
    const byToken = await resolveCaller(bearerRequest(ADMIN_TOKEN), h.ctx, authStub(null))
    const appAdmin = await resolveCaller(consoleRequest, h.ctx, authStub(boss))
    const scoped = await resolveCaller(bearerRequest(key.token), h.ctx, authStub(null))

    expect(await authorize(bySession, need)).toBe("ok")
    expect(await authorize(byToken, need)).toBe("ok")
    // An app admin holds every *app* permission and still isn't an IdP superadmin.
    expect(await authorize(appAdmin, need)).toBe("forbidden")
    expect(await authorize(scoped, need)).toBe("forbidden")
  })

  it("defers app permission needs to the caller", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      permissions: ["app:read"],
    })
    const caller = await resolveCaller(consoleRequest, h.ctx, authStub(user))

    expect(await authorize(caller, { app: "acme", permission: "app:read" })).toBe("ok")
    expect(await authorize(caller, { app: "acme", permission: "app:delete" })).toBe("forbidden")
    expect(await authorize(caller, { app: "other", permission: "app:read" })).toBe("forbidden")
  })
})

describe("requireApiCaller", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness({
      env: { ADMIN_EMAILS: "super@willy.im", ADMIN_API_TOKEN: ADMIN_TOKEN },
    })
    await createApplication(h.ctx, { app: "acme" })
  })
  afterEach(() => h.close())

  const auth = authStub(null)
  const mint = () => mintApiKey(h.ctx, { app: "acme", permissions: ["member:read"] })

  it("401s without a bearer token", async () => {
    const res = await thrown(() =>
      requireApiCaller(new Request("https://idp.willy.im/"), h.ctx, auth),
    )
    expect(res!.status).toBe(401)
    expect(await res!.json()).toEqual({ error: "unauthorized" })
  })

  it("passes a key holding the required permission", async () => {
    const { token } = await mint()
    const caller = await requireApiCaller(bearerRequest(token), h.ctx, auth, {
      app: "acme",
      permission: "member:read",
    })
    expect(caller.kind).toBe("key")
  })

  it("403s a key missing the required permission", async () => {
    const { token } = await mint()
    const res = await thrown(() =>
      requireApiCaller(bearerRequest(token), h.ctx, auth, {
        app: "acme",
        permission: "app:delete",
      }),
    )
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ error: "forbidden" })
  })

  it("403s a key used against a different application", async () => {
    const { token } = await mint()
    const res = await thrown(() =>
      requireApiCaller(bearerRequest(token), h.ctx, auth, {
        app: "other",
        permission: "member:read",
      }),
    )
    expect(res!.status).toBe(403)
  })

  it("reserves cross-app endpoints for the superadmin token", async () => {
    const { token } = await mint()
    const denied = await thrown(() =>
      requireApiCaller(bearerRequest(token), h.ctx, auth, { superadmin: true }),
    )
    expect(denied!.status).toBe(403)

    const allowed = await requireApiCaller(bearerRequest(ADMIN_TOKEN), h.ctx, auth, {
      superadmin: true,
    })
    expect(allowed.kind).toBe("superadmin")
  })
})

describe("requireConsoleCaller", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    await createApplication(h.ctx, { app: "acme" })
  })
  afterEach(() => h.close())

  it("sends an anonymous visitor to /login", async () => {
    const res = await thrown(() => requireConsoleCaller(consoleRequest, h.ctx, authStub(null)))
    expect(res!.status).toBe(302)
    expect(res!.headers.get("location")).toBe("/login")
  })

  it("sends a signed-in non-admin to /account rather than a dead end", async () => {
    const stranger = await createUser(h.ctx, { email: "stranger@elsewhere.test" })
    const res = await thrown(() =>
      requireConsoleCaller(consoleRequest, h.ctx, authStub(stranger), { superadmin: true }),
    )
    expect(res!.status).toBe(302)
    expect(res!.headers.get("location")).toBe("/account")
  })

  it("lets a member with app:read through an app-scoped gate", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      permissions: ["app:read"],
    })

    const caller = await requireConsoleCaller(consoleRequest, h.ctx, authStub(user), {
      app: "acme",
      permission: "app:read",
    })
    expect(caller.userId).toBe(user.id)
  })

  it("logs the gate decision", async () => {
    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })
    await requireConsoleCaller(consoleRequest, h.ctx, authStub(superadmin), { superadmin: true })
    expect(h.logs.find((l) => l.message === "admin.gate")?.fields).toMatchObject({
      admin: true,
      verdict: "ok",
    })
  })
})
