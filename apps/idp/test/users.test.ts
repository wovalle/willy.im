import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { listAuditForApp } from "../app/lib/audit.server"
import type { AuthService } from "../app/lib/auth.server"
import type { IdpPrincipal } from "../app/lib/caller.server"
import {
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  failureOf,
  kitContext,
  memberPrincipal,
  signedInPrincipal,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/** users.list / find at the IdP level, and users.impersonate inside an app. */
describe("users", () => {
  let h: TestHarness
  let root: IdpPrincipal
  let member: { id: string; email: string }

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "acme" })
    member = await createUser(h.ctx, { email: "member@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: member.id, role: "member" })
  })
  afterEach(() => h.close())

  const idp = async (principal = root) => (await kitContext(h.ctx, principal, null)).services.users

  it("lists users with an absolute avatar for those who never uploaded one", async () => {
    const { users } = await (await idp()).list()
    expect(users).toEqual([
      expect.objectContaining({
        id: member.id,
        email: "member@acme.test",
        image: `https://idp.willy.im/avatar/${member.id}`,
      }),
    ])
  })

  it("finds one user by id or by email, and null for nobody", async () => {
    const users = await idp()
    expect((await users.find({ id: member.id })).user?.email).toBe("member@acme.test")
    expect((await users.find({ email: " Member@Acme.test " })).user?.id).toBe(member.id)
    expect(await users.find({ id: "nobody" })).toEqual({ user: null })
    expect((await failureOf(users.find({}))).status).toBe(400)
  })

  it("is superadmin-only", async () => {
    const admin = memberPrincipal("u1", "acme", ["app:read", "member:read"])
    expect((await failureOf((await idp(admin)).list())).status).toBe(403)
  })

  describe("impersonate", () => {
    /** Better Auth, answering an impersonation with one session cookie. */
    const betterAuth = {
      api: {
        impersonateUser: async ({ body }: { body: { userId: string } }) =>
          new Response(null, { headers: { "set-cookie": `session=${body.userId}` } }),
      },
    } as unknown as AuthService

    const impersonate = async (principal: IdpPrincipal, userId: string) =>
      (await kitContext(h.ctx, principal, "acme", { auth: betterAuth })).services.users.impersonate({
        userId,
      })

    it("hands a signed-in superadmin the member's session cookies, and audits it", async () => {
      const admin = await signedInPrincipal(h.ctx, await createUser(h.ctx, { email: "super@willy.im" }))
      expect(await impersonate(admin, member.id)).toEqual({ setCookies: [`session=${member.id}`] })
      expect((await listAuditForApp(h.ctx, "acme"))[0]).toMatchObject({
        tableName: "user",
        operation: "impersonate",
        rowId: member.id,
        actor: admin.id,
      })
    })

    it("404s someone who isn't a member of this app", async () => {
      const admin = await signedInPrincipal(h.ctx, await createUser(h.ctx, { email: "super@willy.im" }))
      const stranger = await createUser(h.ctx, { email: "stranger@x.test" })
      expect(await failureOf(impersonate(admin, stranger.id))).toEqual({
        status: 404,
        error: "That user isn't a member of this app.",
      })
    })

    it("refuses an app admin holding user:impersonate: superadmins only", async () => {
      const appAdmin = await createUser(h.ctx, { email: "admin@acme.test" })
      await createMember(h.ctx, { app: "acme", userId: appAdmin.id, role: "admin" })
      const principal = await signedInPrincipal(h.ctx, appAdmin)
      expect((await failureOf(impersonate(principal, member.id))).status).toBe(403)
    })

    it("doesn't exist for a key, which has no browser session to impersonate from", async () => {
      expect((await failureOf(impersonate(root, member.id))).status).toBe(404)
    })
  })
})
