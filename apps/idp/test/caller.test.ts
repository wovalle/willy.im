import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as schema from "../app/db/schema"
import type { AuthService } from "../app/lib/auth.server"
import { principalFrom } from "../app/lib/caller.server"
import { APP_PERMISSIONS, appRbac } from "../app/lib/permissions"
import {
  bearerRequest,
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  kitContext,
  mintAdminKey,
  mintApiKey,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * `principalFrom`: the one door from a request to who is calling. All it needs
 * from the auth service is `api.getSession`, so it gets a stub rather than a
 * booted Better Auth — what's under test is precedence and how grants resolve.
 * What a principal may do in an app is kit's `callerFor` over it.
 */
function authStub(user: { id: string; email: string } | null, impersonatedBy?: string): AuthService {
  return {
    api: {
      getSession: async () => (user ? { user, session: { impersonatedBy: impersonatedBy ?? null } } : null),
    },
  } as unknown as AuthService
}

const consoleRequest = new Request("https://idp.willy.im/apps/acme")

/** The principal's management permissions in `app` (none when it holds nothing there). */
function grantedIn(principal: Parameters<typeof appRbac.callerFor>[0], app: string) {
  try {
    return appRbac.callerFor(principal, app).granted
  } catch {
    return []
  }
}

describe("principalFrom", () => {
  let h: TestHarness
  /** An IdP-level admin key — the only superadmin credential a bearer can be. */
  let root: Awaited<ReturnType<typeof bootstrapAdminKey>>
  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    root = await bootstrapAdminKey(h.ctx)
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
  })
  afterEach(() => h.close())

  const from = (request: Request, user: { id: string; email: string } | null = null) =>
    principalFrom(request, h.ctx, authStub(user))
  const mint = (overrides: { expiresAt?: Date } = {}) =>
    mintApiKey(h.ctx, { app: "acme", permissions: ["member:read", "member:invite"], ...overrides }, root.principal)

  it("is null when there is neither a bearer token nor a session", async () => {
    expect(await from(consoleRequest)).toBeNull()
  })

  it("prefers the bearer token over the session cookie", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    expect((await from(bearerRequest(root.token), user))?.id).toBe(`adminkey:${root.id}`)
  })

  it("has no env-based backdoor: a bearer that is not a wim_ key is nobody", async () => {
    for (const guess of [process.env.BETTER_AUTH_SECRET!, process.env.ADMIN_EMAILS!, "wim_guess"])
      expect(await from(bearerRequest(guess))).toBeNull()
  })

  it("refuses a bad bearer instead of falling through to a valid cookie", async () => {
    // Presenting a token means "judge me as this token" — inheriting session
    // authority from the cookie would be a privilege escalation.
    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })
    expect(await from(bearerRequest("wim_nope"), superadmin)).toBeNull()
    expect(await from(bearerRequest("not-even-ours"), superadmin)).toBeNull()
  })

  it("makes an allowlisted session email a superadmin who is still a person", async () => {
    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })
    const principal = await from(consoleRequest, superadmin)
    expect(principal).toEqual({ id: `user:${superadmin.id}`, grants: ["*"], memberships: [] })
    // No membership needed, on any app.
    expect(grantedIn(principal, "never-heard-of-it")).toEqual([...APP_PERMISSIONS])
  })

  it("gives a member one membership per app, the role expanded, from one query", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createApplication(h.ctx, { app: "other" })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member", permissions: ["member:read"] })
    await createMember(h.ctx, { app: "other", userId: user.id, role: "admin" })

    const select = vi.spyOn(h.ctx.db, "select")
    const principal = await from(consoleRequest, user)
    expect(select).toHaveBeenCalledTimes(1)
    select.mockRestore()

    expect(principal).toEqual({
      id: `user:${user.id}`,
      grants: [],
      memberships: expect.arrayContaining([
        { tenantId: "acme", grants: ["member:read"] },
        { tenantId: "other", grants: [...APP_PERMISSIONS] },
      ]),
    })
    expect(grantedIn(principal, "acme")).toEqual(["member:read"])
  })

  it("gives a signed-in non-member nothing: any app is a 404 to kit", async () => {
    const stranger = await createUser(h.ctx, { email: "stranger@elsewhere.test" })
    const principal = await from(consoleRequest, stranger)
    expect(principal).toEqual({ id: `user:${stranger.id}`, grants: [], memberships: [] })
    expect(() => appRbac.callerFor(principal, "acme")).toThrow()
  })

  it("keeps the target's grants when impersonating, naming the impersonator as the actor", async () => {
    const admin = await createUser(h.ctx, { email: "super@willy.im" })
    const target = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: target.id, role: "member", permissions: ["member:read"] })

    const principal = await principalFrom(consoleRequest, h.ctx, authStub(target, admin.id))
    expect(principal).toEqual({
      id: `user:${target.id}`,
      grants: [],
      memberships: [{ tenantId: "acme", grants: ["member:read"] }],
      actor: { id: `user:${admin.id}` },
    })
    // Both people land in the trail: who acted, and as whom.
    await (await kitContext(h.ctx, principal, "acme")).audit.record({ table: "user", operation: "update" })
    const [row] = await h.ctx.db.select().from(schema.auditLog)
    expect(row).toMatchObject({ user_id: admin.id, actor: `user:${admin.id} as user:${target.id}` })
  })

  it("resolves a scoped key to one membership holding its permissions", async () => {
    const { token, id } = await mint()
    const principal = await from(bearerRequest(token))
    expect(principal).toEqual({
      id: `apikey:${id}`,
      grants: [],
      memberships: [{ tenantId: "acme", grants: ["member:read", "member:invite"] }],
    })
    expect(grantedIn(principal, "other")).toEqual([])
  })

  it("refuses a revoked or expired scoped key", async () => {
    const { token, id } = await mint()
    await (await kitContext(h.ctx, root.principal, "acme")).services.management_keys.revoke({ id })
    expect(await from(bearerRequest(token))).toBeNull()
    const expired = await mint({ expiresAt: new Date(Date.now() - 1000) })
    expect(await from(bearerRequest(expired.token))).toBeNull()
  })

  it("resolves an admin key to a superadmin the audit log can name, bumping lastUsedAt", async () => {
    const { token, id } = await mintAdminKey(h.ctx, { name: "Agent alpha" }, root.principal)
    expect(await from(bearerRequest(token))).toEqual({ id: `adminkey:${id}`, grants: ["*"], memberships: [] })

    const [row] = await h.ctx.db
      .select({ lastUsedAt: schema.apiKey.lastUsedAt })
      .from(schema.apiKey)
      .where(eq(schema.apiKey.id, id))
    expect(row.lastUsedAt).toBeInstanceOf(Date)
  })

  it("refuses a revoked or expired admin key", async () => {
    const { token, id } = await mintAdminKey(h.ctx, {}, root.principal)
    await (await kitContext(h.ctx, root.principal, null)).services.admin_keys.revoke({ id })
    expect(await from(bearerRequest(token))).toBeNull()
    const expired = await mintAdminKey(h.ctx, { expiresAt: new Date(Date.now() - 1000) }, root.principal)
    expect(await from(bearerRequest(expired.token))).toBeNull()
  })
})
