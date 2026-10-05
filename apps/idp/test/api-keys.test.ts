import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import * as schema from "../app/db/schema"
import type { AuthService } from "../app/lib/auth.server"
import { listAuditForApp } from "../app/lib/audit.server"
import { principalFrom, type IdpPrincipal } from "../app/lib/caller.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import {
  bearerRequest,
  bootstrapAdminKey,
  createMember,
  createUser,
  failureOf,
  kitContext,
  memberPrincipal,
  signedInPrincipal,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * management_keys: minting, listing and revoking an app's management keys.
 * Resolving a presented token to a principal lives in caller.test.ts — this
 * file is only the store.
 */
describe("management_keys", () => {
  let h: TestHarness
  let creator: { id: string }
  /** A real IdP-level admin key, resolved through the production resolver. */
  let root: IdpPrincipal

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    creator = await createUser(h.ctx, { email: "creator@acme.test" })
  })
  afterEach(() => h.close())

  /** The console's path: a signed-in app admin mints the key. */
  const admin = () =>
    memberPrincipal(creator.id, "acme", [
      "apikey:create",
      "apikey:read",
      "apikey:revoke",
      "member:read",
      "member:invite",
    ])

  const keys = async (principal: IdpPrincipal = admin(), app = "acme") =>
    (await kitContext(h.ctx, principal, app)).services.management_keys

  const mint = async (
    overrides: { permissions?: string[]; expiresAt?: string } = {},
    principal: IdpPrincipal = admin(),
  ) =>
    (await keys(principal)).mint({
      name: "CI runner",
      permissions: ["member:read", "member:invite"],
      ...overrides,
    })

  const list = async () => (await (await keys(root)).list()).keys

  it("returns the plaintext token exactly once and never stores it", async () => {
    const { token, prefix, id } = await mint()

    expect(token.startsWith("wim_")).toBe(true)
    expect(prefix).toBe(token.slice(0, 12))

    const [listed] = await list()
    expect(listed.id).toBe(id)
    expect(JSON.stringify(listed)).not.toContain(token)
    expect(listed.status).toBe("active")
  })

  it("drops permissions that are not in the management catalog", async () => {
    await mint({ permissions: ["member:read", "not:a-real-permission"] })
    expect((await list())[0].permissions).toEqual(["member:read"])
  })

  it("marks a revoked key revoked, idempotently", async () => {
    const { id } = await mint()
    const k = await keys()
    expect(await k.revoke({ id })).toEqual({ ok: true })
    expect(await k.revoke({ id })).toEqual({ ok: true })
    expect((await list())[0].status).toBe("revoked")
  })

  it("reports a past expiry as expired", async () => {
    await mint({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect((await list())[0].status).toBe("expired")
  })

  it("will not let one app revoke another app's key", async () => {
    const { id } = await mint()
    expect(await failureOf((await keys(root, "other")).revoke({ id }))).toEqual({
      status: 404,
      error: "Key not found.",
    })
    expect((await list())[0]).toMatchObject({ id, status: "active" })
  })

  it("accepts a machine caller — an admin key has no user behind it", async () => {
    const { id } = await mint({}, root)
    expect((await list())[0].id).toBe(id)
  })

  it("records an audit entry with the caller's label", async () => {
    const { id } = await mint()

    const [entry] = await listAuditForApp(h.ctx, "acme")
    expect(entry).toMatchObject({
      tableName: "api_key",
      operation: "create",
      rowId: id,
      actor: `user:${creator.id}`,
      userId: creator.id,
    })
  })

  it("audits a revoke once, not on the idempotent repeat", async () => {
    const { id } = await mint()
    const k = await keys()
    await k.revoke({ id })
    await k.revoke({ id })

    const revokes = (await listAuditForApp(h.ctx, "acme")).filter((e) => e.operation === "revoke")
    expect(revokes).toHaveLength(1)
    expect(revokes[0]).toMatchObject({ tableName: "api_key", rowId: id })
  })

  describe("permission escalation", () => {
    /** May mint keys, and holds exactly one other permission. */
    const minter = () => memberPrincipal(creator.id, "acme", ["apikey:create", "member:read"])

    it("lets a caller grant a subset of what it holds", async () => {
      expect(await mint({ permissions: ["member:read"] }, minter())).toHaveProperty("token")
    })

    it("403s minting permissions the caller doesn't hold, naming them", async () => {
      expect(
        await failureOf(mint({ permissions: ["member:read", "member:manage"] }, minter())),
      ).toEqual({ status: 403, error: "You can't grant permissions you don't hold: member:manage." })

      // Nothing was written — a rejected mint leaves no key behind.
      expect(await list()).toHaveLength(0)
    })

    it("lets a superadmin mint anything", async () => {
      await mint({ permissions: [...APP_PERMISSIONS] }, root)
      expect((await list())[0].permissions).toEqual([...APP_PERMISSIONS])
    })

    it("403s a caller without apikey:create before it looks at the permissions", async () => {
      const powerless = memberPrincipal(creator.id, "acme", [])
      expect((await failureOf(mint({ permissions: [] }, powerless))).status).toBe(403)
    })
  })
})

/**
 * A key minted by a human is only as good as that human — the same rule as
 * end-user keys (`wak_`) and app tokens (`wat_`). Removing or narrowing the
 * creator must kill the keys they minted, or a removed member keeps managing
 * the app through a key nobody remembers to revoke.
 */
describe("management keys follow their creator", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
  })
  afterEach(() => h.close())

  const resolve = (token: string) => principalFrom(bearerRequest(token), h.ctx, {} as AuthService)

  /** A real member of acme holding `permissions`, and the services they act through. */
  const memberOf = async (email: string, permissions: string[]) => {
    const user = await createUser(h.ctx, { email })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member", permissions })
    return { user, principal: await signedInPrincipal(h.ctx, user) }
  }

  const mintAs = async (principal: IdpPrincipal, permissions: string[]) =>
    (await kitContext(h.ctx, principal, "acme")).services.management_keys.mint({
      name: "minted by a human",
      permissions,
    })

  it("works while the creator is a member holding its permissions", async () => {
    const { principal } = await memberOf("m@acme.test", ["apikey:create", "member:invite"])
    const { token } = await mintAs(principal, ["member:invite"])

    expect((await resolve(token))?.memberships).toEqual([
      { tenantId: "acme", grants: ["member:invite"] },
    ])
  })

  it("is refused once the creator is removed from the app", async () => {
    const { user, principal } = await memberOf("m@acme.test", ["apikey:create", "member:invite"])
    const { token } = await mintAs(principal, ["member:invite"])

    const admin = await createUser(h.ctx, { email: "admin@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: admin.id, role: "admin" })
    await (await kitContext(h.ctx, await signedInPrincipal(h.ctx, admin), "acme")).services.members.remove({
      userId: user.id,
    })

    expect(await resolve(token)).toBeNull()
    expect(h.logs.some((l) => l.message === "apikey.creator_lost_access")).toBe(true)
  })

  it("is refused once the creator no longer holds a permission the key carries", async () => {
    const { user, principal } = await memberOf("m@acme.test", ["apikey:create", "member:invite"])
    const { token } = await mintAs(principal, ["member:invite"])

    await h.ctx.db
      .update(schema.applicationMember)
      .set({ permissions: ["apikey:create"] })
      .where(eq(schema.applicationMember.userId, user.id))

    expect(await resolve(token)).toBeNull()
  })

  it("refuses an admin key once its human creator leaves the superadmin allowlist", async () => {
    const boss = await createUser(h.ctx, { email: "super@willy.im" })
    const { token } = await (
      await kitContext(h.ctx, await signedInPrincipal(h.ctx, boss), null)
    ).services.admin_keys.mint({ name: "agent" })
    expect((await resolve(token))?.grants).toEqual(["*"])

    process.env.ADMIN_EMAILS = "someone-else@willy.im"
    expect(await resolve(token)).toBeNull()
  })

  it("keeps a key minted by a key (no human creator) judged by its own row", async () => {
    const root = (await bootstrapAdminKey(h.ctx)).principal
    const { token } = await mintAs(root, ["member:read"])
    expect((await resolve(token))?.memberships).toEqual([{ tenantId: "acme", grants: ["member:read"] }])
  })
})
