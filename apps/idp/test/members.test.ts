import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import * as schema from "../app/db/schema"
import { listAuditForApp } from "../app/lib/audit.server"
import type { IdpPrincipal } from "../app/lib/caller.server"
import { claimInvitationsForUser } from "../app/lib/members.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import type { ResourceLister } from "../app/lib/resources.server"
import {
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  failureOf,
  kitContext,
  memberPrincipal,
  noResources,
  setCatalog,
  signedInPrincipal,
  stubResources,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

const THREAD = { type: "kirby:thread", label: "Thread", list: "https://acme.test/t" }

const memberRow = async (h: TestHarness, app: string, userId: string) => {
  const [row] = await h.ctx.db
    .select()
    .from(schema.applicationMember)
    .where(
      and(
        eq(schema.applicationMember.applicationId, app),
        eq(schema.applicationMember.userId, userId),
      ),
    )
    .limit(1)
  return row ?? null
}

/** The `members` and `invitations` services of `principal` in acme. */
const servicesOf = async (
  h: TestHarness,
  principal: IdpPrincipal,
  resources: ResourceLister = noResources,
) => (await kitContext(h.ctx, principal, "acme", { resources })).services

/**
 * Invitations: unknown emails become a pending application_invitation row that
 * converts to an application_member on the invitee's first sign-in; known
 * emails skip the invite and join immediately.
 */
describe("members.invite and invitations", () => {
  let h: TestHarness
  let inviter: { id: string }
  /** A real IdP-level admin key, resolved through the production resolver. */
  let root: IdpPrincipal

  const CATALOG = ["invoices:read", "invoices:write"]

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    inviter = await createUser(h.ctx, { email: "inviter@acme.test" })
  })
  afterEach(() => h.close())

  const invite = async (
    overrides: {
      email?: string
      role?: "admin" | "member"
      permissions?: string[]
      productPermissions?: string[]
    } = {},
    // Holds what the default invite hands out (member:read) and nothing more.
    as: IdpPrincipal = memberPrincipal(inviter.id, "acme", ["member:invite", "member:read"]),
    resources?: ResourceLister,
  ) =>
    (await servicesOf(h, as, resources)).members.invite({
      email: "newcomer@acme.test",
      role: "member",
      permissions: ["member:read"],
      productPermissions: ["invoices:read"],
      ...overrides,
    })

  const pending = async () => (await (await servicesOf(h, root)).invitations.list()).invitations

  it("creates a pending invitation for an email with no account", async () => {
    expect(await invite()).toEqual({ result: "invited" })

    const [invitation] = await pending()
    expect(invitation.email).toBe("newcomer@acme.test")
    expect(invitation.role).toBe("member")
    expect(invitation.permissions).toEqual(["member:read"])
    expect(Date.parse(invitation.expiresAt)).toBeGreaterThan(Date.now())
  })

  it("normalizes the invited email so sign-in matches it", async () => {
    await invite({ email: "  NewComer@Acme.TEST " })
    expect((await pending())[0].email).toBe("newcomer@acme.test")
  })

  it("logs the accept link outside production, linking back to the host that asked", async () => {
    await invite()
    expect(h.logs.find((l) => l.message.startsWith("[invite]"))?.message).toContain(
      "https://idp.willy.im/invite/accept?token=",
    )
  })

  it("converts a pending invitation to membership on sign-in, carrying the grants", async () => {
    await invite()
    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })

    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })

    const member = await memberRow(h, "acme", user.id)
    expect(member).not.toBeNull()
    expect(member!.role).toBe("member")
    expect(member!.permissions).toEqual(["member:read"])
    expect(member!.productPermissions).toEqual(["invoices:read"])
    // The invitation row is the record of a *pending* invite only.
    expect(await pending()).toHaveLength(0)
  })

  it("is idempotent when claimed twice", async () => {
    await invite()
    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })

    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })
    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })

    const rows = await h.ctx.db
      .select()
      .from(schema.applicationMember)
      .where(eq(schema.applicationMember.userId, user.id))
    expect(rows).toHaveLength(1)
  })

  it("drops an expired invitation instead of honoring it", async () => {
    await invite()
    await h.ctx.db
      .update(schema.applicationInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.applicationInvitation.applicationId, "acme"))

    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })
    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })

    expect(await memberRow(h, "acme", user.id)).toBeNull()
    expect(await pending()).toHaveLength(0)
  })

  it("refreshes the expiry when an invitation is resent", async () => {
    await invite()
    const [invitation] = await pending()
    await h.ctx.db
      .update(schema.applicationInvitation)
      .set({ expiresAt: new Date(Date.now() + 1000) })
      .where(eq(schema.applicationInvitation.id, invitation.id))

    const services = await servicesOf(h, root)
    expect(await services.invitations.resend({ id: invitation.id })).toEqual({ ok: true })
    expect(Date.parse((await pending())[0].expiresAt)).toBeGreaterThan(Date.now() + 60_000)
  })

  it("404s resending an invitation that isn't this app's", async () => {
    const services = await servicesOf(h, root)
    expect(await failureOf(services.invitations.resend({ id: "nope" }))).toEqual({
      status: 404,
      error: "Invitation not found.",
    })
  })

  it("revokes a pending invitation so sign-in grants nothing", async () => {
    await invite()
    const [invitation] = await pending()
    await (await servicesOf(h, root)).invitations.revoke({ id: invitation.id })

    expect(await pending()).toHaveLength(0)

    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })
    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })
    expect(await memberRow(h, "acme", user.id)).toBeNull()
  })

  it("adds an existing user straight to membership, no invitation row", async () => {
    const existing = await createUser(h.ctx, { email: "known@acme.test" })
    expect(await invite({ email: "known@acme.test" })).toEqual({ result: "added" })

    expect(await pending()).toHaveLength(0)
    expect(await memberRow(h, "acme", existing.id)).not.toBeNull()
  })

  it("409s an existing member instead of duplicating them", async () => {
    const existing = await createUser(h.ctx, { email: "known@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: existing.id, role: "member" })

    expect(await failureOf(invite({ email: "known@acme.test" }))).toEqual({
      status: 409,
      error: "known@acme.test is already a member.",
    })
  })

  it("keeps grants scoped to the invited app", async () => {
    await createApplication(h.ctx, { app: "other", permissions: CATALOG })
    await invite()
    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })
    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })

    expect(await memberRow(h, "acme", user.id)).not.toBeNull()
    expect(await memberRow(h, "other", user.id)).toBeNull()
  })

  it("stores no explicit grants for an admin (they resolve to everything)", async () => {
    const existing = await createUser(h.ctx, { email: "boss@acme.test" })
    await invite(
      {
        email: "boss@acme.test",
        role: "admin",
        permissions: ["member:read"],
        productPermissions: ["invoices:read"],
      },
      memberPrincipal(inviter.id, "acme", [...APP_PERMISSIONS]),
    )

    const member = await memberRow(h, "acme", existing.id)
    expect(member!.role).toBe("admin")
    expect(member!.permissions).toEqual([])
    expect(member!.productPermissions).toEqual([])
  })

  it("audits the invite against the app, naming the actor", async () => {
    await invite()

    const [entry] = await listAuditForApp(h.ctx, "acme")
    expect(entry).toMatchObject({
      tableName: "application_invitation",
      operation: "invite",
      actor: `user:${inviter.id}`,
      userId: inviter.id,
    })
  })

  it("audits an immediate join against application_member instead", async () => {
    await createUser(h.ctx, { email: "known@acme.test" })
    await invite({ email: "known@acme.test" })

    const [entry] = await listAuditForApp(h.ctx, "acme")
    expect(entry).toMatchObject({ tableName: "application_member", operation: "invite" })
  })

  it("refuses a caller without member:invite", async () => {
    const outsider = memberPrincipal("nosy", "acme", ["member:read"])
    expect((await failureOf(invite({ permissions: [] }, outsider))).status).toBe(403)
    expect(await pending()).toHaveLength(0)
  })

  it("refuses product grants the app never declared, naming them, rather than dropping them", async () => {
    await createUser(h.ctx, { email: "known@acme.test" })
    expect(
      await failureOf(
        invite({ email: "known@acme.test", productPermissions: ["invoices:read", "not:declared"] }),
      ),
    ).toEqual({ status: 422, error: "Not in this app's catalog: not:declared" })
  })

  it("keeps an instance grant the app lists under a declared resource type", async () => {
    await setCatalog(h.ctx, "acme", { resourceTypes: [THREAD] })
    const existing = await createUser(h.ctx, { email: "threads@acme.test" })
    await invite(
      { email: "threads@acme.test", productPermissions: ["kirby:thread:t_1"] },
      undefined,
      stubResources({ "kirby:thread": [{ id: "t_1", label: "One", description: null }] }),
    )
    expect((await memberRow(h, "acme", existing.id))!.productPermissions).toEqual([
      "kirby:thread:t_1",
    ])
  })
})

describe("members.set_access and members.remove", () => {
  let h: TestHarness
  /** A real IdP-level admin key, resolved through the production resolver. */
  let root: IdpPrincipal
  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
  })
  afterEach(() => h.close())

  const members = async (as = root, resources?: ResourceLister) =>
    (await servicesOf(h, as, resources)).members

  it("lists members with both kinds of grants", async () => {
    const deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: deputy.id,
      role: "member",
      permissions: ["member:read"],
      productPermissions: ["invoices:read"],
    })
    expect((await (await members()).list()).members).toEqual([
      {
        userId: deputy.id,
        email: "deputy@acme.test",
        name: "deputy@acme.test",
        role: "member",
        permissions: ["member:read"],
        productPermissions: ["invoices:read"],
      },
    ])
  })

  it("409s demoting the last admin", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })

    expect(
      await failureOf(
        (await members()).set_access({ userId: boss.id, role: "member", permissions: [] }),
      ),
    ).toEqual({ status: 409, error: "Can't demote the last admin — promote someone else first." })
  })

  it("409s removing the last admin", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })

    expect(await failureOf((await members()).remove({ userId: boss.id }))).toEqual({
      status: 409,
      error: "Can't remove the last admin — promote someone else first.",
    })
  })

  it("allows demoting an admin once a second one exists", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    const deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    await createMember(h.ctx, { app: "acme", userId: deputy.id, role: "admin" })

    expect(
      await (await members()).set_access({
        userId: deputy.id,
        role: "member",
        permissions: ["member:read"],
        productPermissions: ["invoices:read"],
      }),
    ).toEqual({ ok: true })
  })

  it("leaves product grants alone when they're omitted, and replaces them when sent", async () => {
    const deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: deputy.id,
      role: "member",
      productPermissions: ["invoices:read"],
    })
    const m = await members()
    await m.set_access({ userId: deputy.id, role: "member", permissions: ["member:read"] })
    expect((await memberRow(h, "acme", deputy.id))!.productPermissions).toEqual(["invoices:read"])
    await m.set_access({ userId: deputy.id, role: "member", permissions: [], productPermissions: [] })
    expect((await memberRow(h, "acme", deputy.id))!.productPermissions).toEqual([])
  })

  it("keeps an instance grant while its type is declared, and drops it when it isn't", async () => {
    // The grant is stored as the composed string; what makes it valid is the
    // TYPE still being in the catalog. A grant the member already holds is not
    // re-checked against the app's list on every edit.
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    const deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    await createMember(h.ctx, { app: "acme", userId: deputy.id, role: "member" })
    await setCatalog(h.ctx, "acme", { resourceTypes: [THREAD] })
    const lister = stubResources({ "kirby:thread": [{ id: "t_1", label: "One", description: null }] })

    const edit = async () =>
      (await members(root, lister)).set_access({
        userId: deputy.id,
        role: "member",
        permissions: ["member:read"],
        productPermissions: ["invoices:read", "kirby:thread:t_1"],
      })

    expect(await edit()).toEqual({ ok: true })
    expect((await memberRow(h, "acme", deputy.id))!.productPermissions).toEqual([
      "invoices:read",
      "kirby:thread:t_1",
    ])

    // The app removed the type from its catalog; the grant no longer names
    // anything the app admits to having.
    await setCatalog(h.ctx, "acme", { resourceTypes: [] })
    expect(await edit()).toEqual({ ok: true })
    expect((await memberRow(h, "acme", deputy.id))!.productPermissions).toEqual(["invoices:read"])
  })

  it("refuses to update or remove a member without member:manage", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    // member:invite is deliberately *not* member:manage — inviting someone is
    // not the same authority as rewriting or deleting an existing member.
    const inviter = await members(memberPrincipal("u1", "acme", ["member:invite"]))

    expect(
      (await failureOf(inviter.set_access({ userId: boss.id, role: "member", permissions: [] })))
        .status,
    ).toBe(403)
    expect((await failureOf(inviter.remove({ userId: boss.id }))).status).toBe(403)
  })

  it("audits an update and a removal against the app, naming the key", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    const deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    await createMember(h.ctx, { app: "acme", userId: deputy.id, role: "member" })

    const m = await members()
    await m.set_access({ userId: deputy.id, role: "member", permissions: ["member:read"] })
    await m.remove({ userId: deputy.id })

    const entries = await listAuditForApp(h.ctx, "acme")
    expect(entries.map((e) => [e.tableName, e.operation, e.rowId])).toEqual([
      ["application_member", "delete", deputy.id],
      ["application_member", "update", deputy.id],
    ])
    expect(entries[0].actor).toBe(root.id)
  })

  it("404s a missing member rather than silently succeeding", async () => {
    expect(await failureOf((await members()).remove({ userId: "ghost" }))).toEqual({
      status: 404,
      error: "Member not found.",
    })
  })
})

/**
 * Whoever hands out management grants must hold them: `member:invite` and
 * `member:manage` are the authority to invite and edit, not to mint
 * permissions the caller doesn't have. Product permissions are the app's, so
 * they stay out of this check.
 */
describe("handing out management grants", () => {
  let h: TestHarness
  let root: IdpPrincipal
  let manager: { id: string; email: string }
  let deputy: { id: string; email: string }
  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
    manager = await createUser(h.ctx, { email: "manager@acme.test" })
    deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: manager.id,
      role: "member",
      permissions: ["member:invite", "member:manage", "member:read"],
    })
    await createMember(h.ctx, { app: "acme", userId: deputy.id, role: "member" })
  })
  afterEach(() => h.close())

  const roleOf = async (userId: string) => (await memberRow(h, "acme", userId))!
  const as = async (user: { id: string; email: string }) =>
    servicesOf(h, await signedInPrincipal(h.ctx, user))

  it("refuses a member:manage holder promoting someone to admin", async () => {
    const { members } = await as(manager)
    expect(
      (await failureOf(members.set_access({ userId: deputy.id, role: "admin", permissions: [] })))
        .status,
    ).toBe(403)
    expect((await roleOf(deputy.id)).role).toBe("member")
  })

  it("refuses a member:manage holder promoting themselves to admin", async () => {
    const { members } = await as(manager)
    expect(
      (await failureOf(members.set_access({ userId: manager.id, role: "admin", permissions: [] })))
        .status,
    ).toBe(403)
    expect((await roleOf(manager.id)).role).toBe("member")
  })

  it("refuses a member:manage holder granting a permission they lack", async () => {
    const { members } = await as(manager)
    const res = members.set_access({
      userId: deputy.id,
      role: "member",
      permissions: ["member:read", "apikey:create"],
    })
    expect((await failureOf(res)).status).toBe(403)
    expect((await roleOf(deputy.id)).permissions).toEqual([])
  })

  it("lets a member:manage holder grant what they hold", async () => {
    const { members } = await as(manager)
    expect(
      await members.set_access({ userId: deputy.id, role: "member", permissions: ["member:read"] }),
    ).toEqual({ ok: true })
    expect((await roleOf(deputy.id)).permissions).toEqual(["member:read"])
  })

  it("refuses an inviter handing out admin or a permission they lack", async () => {
    const { members, invitations } = await as(manager)
    const base = { email: "newcomer@acme.test" }
    expect((await failureOf(members.invite({ ...base, role: "admin" }))).status).toBe(403)
    expect(
      (await failureOf(members.invite({ ...base, role: "member", permissions: ["audit:read"] })))
        .status,
    ).toBe(403)
    expect((await invitations.list()).invitations).toHaveLength(0)
  })

  it("lets an app admin promote someone to admin and invite one", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    const { members } = await as(boss)

    expect(
      await members.set_access({ userId: deputy.id, role: "admin", permissions: [] }),
    ).toEqual({ ok: true })
    expect((await roleOf(deputy.id)).role).toBe("admin")
    expect(await members.invite({ email: "newcomer@acme.test", role: "admin" })).toEqual({
      result: "invited",
    })
  })

  it("lets a superadmin promote someone to admin, by key or by session", async () => {
    const byKey = (await servicesOf(h, root)).members
    expect(await byKey.set_access({ userId: deputy.id, role: "admin", permissions: [] })).toEqual({
      ok: true,
    })

    const superadmin = await createUser(h.ctx, { email: "super@willy.im" })
    const { members } = await as(superadmin)
    expect(
      await members.set_access({ userId: manager.id, role: "admin", permissions: [] }),
    ).toEqual({ ok: true })
    expect((await roleOf(manager.id)).role).toBe("admin")
  })
})
