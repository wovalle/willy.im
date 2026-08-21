import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import * as schema from "../app/db/schema"
import { listAuditForApp } from "../app/lib/audit.server"
import {
  addOrInviteAppMember,
  claimInvitationsForUser,
  listAppInvitations,
  removeAppMember,
  resendInvitation,
  revokeInvitation,
  updateAppMember,
} from "../app/lib/members.server"
import {
  createApplication,
  createMember,
  createUser,
  fakeUserCaller,
  tokenSuperadmin,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Invitations: unknown emails become a pending application_invitation row that
 * converts to an application_member on the invitee's first sign-in; known
 * emails skip the invite and join immediately.
 */
describe("invitations", () => {
  let h: TestHarness
  let inviter: { id: string }

  const CATALOG = ["invoices:read", "invoices:write"]

  beforeEach(async () => {
    h = createTestHarness()
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    inviter = await createUser(h.ctx, { email: "inviter@acme.test" })
  })
  afterEach(() => h.close())

  const invite = (overrides: Partial<Parameters<typeof addOrInviteAppMember>[2]> = {}) =>
    addOrInviteAppMember(
      h.ctx,
      fakeUserCaller({ userId: inviter.id, app: "acme", permissions: ["member:invite"] }),
      {
        app: "acme",
        email: "newcomer@acme.test",
        role: "member",
        permissions: ["member:read"],
        productPermissions: ["invoices:read"],
        catalog: CATALOG,
        origin: "https://idp.willy.im",
        ...overrides,
      },
    )

  const memberRow = async (app: string, userId: string) => {
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

  it("creates a pending invitation for an email with no account", async () => {
    expect(await invite()).toEqual({ kind: "invited" })

    const [pending] = await listAppInvitations(h.ctx, "acme")
    expect(pending.email).toBe("newcomer@acme.test")
    expect(pending.role).toBe("member")
    expect(pending.permissions).toEqual(["member:read"])
    expect(pending.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it("normalizes the invited email so sign-in matches it", async () => {
    await invite({ email: "  NewComer@Acme.TEST " })
    const [pending] = await listAppInvitations(h.ctx, "acme")
    expect(pending.email).toBe("newcomer@acme.test")
  })

  it("converts a pending invitation to membership on sign-in, carrying the grants", async () => {
    await invite()
    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })

    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })

    const member = await memberRow("acme", user.id)
    expect(member).not.toBeNull()
    expect(member!.role).toBe("member")
    expect(member!.permissions).toEqual(["member:read"])
    expect(member!.productPermissions).toEqual(["invoices:read"])
    // The invitation row is the record of a *pending* invite only.
    expect(await listAppInvitations(h.ctx, "acme")).toHaveLength(0)
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

    expect(await memberRow("acme", user.id)).toBeNull()
    expect(await listAppInvitations(h.ctx, "acme")).toHaveLength(0)
  })

  it("refreshes the expiry when an invitation is resent", async () => {
    await invite()
    const [pending] = await listAppInvitations(h.ctx, "acme")
    await h.ctx.db
      .update(schema.applicationInvitation)
      .set({ expiresAt: new Date(Date.now() + 1000) })
      .where(eq(schema.applicationInvitation.id, pending.id))

    const result = await resendInvitation(h.ctx, tokenSuperadmin(), {
      app: "acme",
      invitationId: pending.id,
      origin: "https://idp.willy.im",
    })
    expect(result).toEqual({ ok: true })

    const [refreshed] = await listAppInvitations(h.ctx, "acme")
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60_000)
  })

  it("revokes a pending invitation so sign-in grants nothing", async () => {
    await invite()
    const [pending] = await listAppInvitations(h.ctx, "acme")
    await revokeInvitation(h.ctx, tokenSuperadmin(), { app: "acme", invitationId: pending.id })

    expect(await listAppInvitations(h.ctx, "acme")).toHaveLength(0)

    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })
    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })
    expect(await memberRow("acme", user.id)).toBeNull()
  })

  it("adds an existing user straight to membership, no invitation row", async () => {
    const existing = await createUser(h.ctx, { email: "known@acme.test" })
    expect(await invite({ email: "known@acme.test" })).toEqual({ kind: "added" })

    expect(await listAppInvitations(h.ctx, "acme")).toHaveLength(0)
    expect(await memberRow("acme", existing.id)).not.toBeNull()
  })

  it("reports an existing member instead of duplicating them", async () => {
    const existing = await createUser(h.ctx, { email: "known@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: existing.id, role: "member" })

    expect(await invite({ email: "known@acme.test" })).toEqual({ kind: "already-member" })
  })

  it("keeps grants scoped to the invited app", async () => {
    await createApplication(h.ctx, { app: "other", permissions: CATALOG })
    await invite()
    const user = await createUser(h.ctx, { email: "newcomer@acme.test" })
    await claimInvitationsForUser(h.ctx, { id: user.id, email: user.email })

    expect(await memberRow("acme", user.id)).not.toBeNull()
    expect(await memberRow("other", user.id)).toBeNull()
  })

  it("stores no explicit grants for an admin (they resolve to everything)", async () => {
    const existing = await createUser(h.ctx, { email: "boss@acme.test" })
    await invite({
      email: "boss@acme.test",
      role: "admin",
      permissions: ["member:read"],
      productPermissions: ["invoices:read"],
    })

    const member = await memberRow("acme", existing.id)
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
    const outsider = fakeUserCaller({ userId: "nosy", app: "acme", permissions: ["member:read"] })
    await expect(
      addOrInviteAppMember(h.ctx, outsider, {
        app: "acme",
        email: "newcomer@acme.test",
        role: "member",
        permissions: [],
        origin: "https://idp.willy.im",
      }),
    ).rejects.toMatchObject({ status: 403 })

    expect(await listAppInvitations(h.ctx, "acme")).toHaveLength(0)
  })

  it("drops product-permission grants the app never declared", async () => {
    const existing = await createUser(h.ctx, { email: "known@acme.test" })
    await invite({
      email: "known@acme.test",
      productPermissions: ["invoices:read", "not:declared"],
    })

    const member = await memberRow("acme", existing.id)
    expect(member!.productPermissions).toEqual(["invoices:read"])
  })
})

describe("member management", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness()
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
  })
  afterEach(() => h.close())

  it("refuses to demote the last admin", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })

    const result = await updateAppMember(h.ctx, tokenSuperadmin(), {
      app: "acme",
      userId: boss.id,
      role: "member",
      permissions: [],
    })
    expect(result).toEqual({
      error: "Can't demote the last admin — promote someone else first.",
    })
  })

  it("refuses to remove the last admin", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })

    expect(
      await removeAppMember(h.ctx, tokenSuperadmin(), { app: "acme", userId: boss.id }),
    ).toEqual({
      error: "Can't remove the last admin — promote someone else first.",
    })
  })

  it("allows demoting an admin once a second one exists", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    const deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    await createMember(h.ctx, { app: "acme", userId: deputy.id, role: "admin" })

    expect(
      await updateAppMember(h.ctx, tokenSuperadmin(), {
        app: "acme",
        userId: deputy.id,
        role: "member",
        permissions: ["member:read"],
        productPermissions: ["invoices:read"],
        catalog: ["invoices:read"],
      }),
    ).toEqual({ ok: true })
  })

  it("refuses to update or remove a member without member:manage", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    // member:invite is deliberately *not* member:manage — inviting someone is
    // not the same authority as rewriting or deleting an existing member.
    const inviter = fakeUserCaller({ userId: "u1", app: "acme", permissions: ["member:invite"] })

    await expect(
      updateAppMember(h.ctx, inviter, {
        app: "acme",
        userId: boss.id,
        role: "member",
        permissions: [],
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      removeAppMember(h.ctx, inviter, { app: "acme", userId: boss.id }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("audits an update and a removal with the before/after the trail needs", async () => {
    const boss = await createUser(h.ctx, { email: "boss@acme.test" })
    const deputy = await createUser(h.ctx, { email: "deputy@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: boss.id, role: "admin" })
    await createMember(h.ctx, { app: "acme", userId: deputy.id, role: "member" })

    await updateAppMember(h.ctx, tokenSuperadmin(), {
      app: "acme",
      userId: deputy.id,
      role: "member",
      permissions: ["member:read"],
    })
    await removeAppMember(h.ctx, tokenSuperadmin(), { app: "acme", userId: deputy.id })

    const entries = await listAuditForApp(h.ctx, "acme")
    expect(entries.map((e) => [e.tableName, e.operation, e.rowId])).toEqual([
      ["application_member", "delete", deputy.id],
      ["application_member", "update", deputy.id],
    ])
    expect(entries[0].actor).toBe("superadmin-token")
  })

  it("reports a missing member rather than silently succeeding", async () => {
    expect(
      await removeAppMember(h.ctx, tokenSuperadmin(), { app: "acme", userId: "ghost" }),
    ).toEqual({
      error: "Member not found.",
    })
  })
})
