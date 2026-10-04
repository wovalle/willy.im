import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import * as schema from "../app/db/schema"
import { listAuditForApp } from "../app/lib/audit.server"
import type { IdpPrincipal } from "../app/lib/caller.server"
import type { ResourceLister } from "../app/lib/resources.server"
import {
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  failureOf,
  kitContext,
  memberPrincipal,
  stubResources,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * End-user API keys (`user_keys.*`): minted by an app for one of its users,
 * validated back through the IdP. Scopes come from the app's declared product
 * catalog, and never exceed what the owner holds in the app.
 */
describe("end-user API keys", () => {
  let h: TestHarness
  let user: { id: string }
  /** A real IdP-level admin key, resolved through the production resolver. */
  let root: IdpPrincipal

  const CATALOG = ["invoices:read", "invoices:write"]

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    user = await createUser(h.ctx, { email: "enduser@acme.test" })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      productPermissions: CATALOG,
    })
  })
  afterEach(() => h.close())

  /** Rewrites the owner's membership in place: what a demotion or removal does. */
  const setMembership = async (change: { productPermissions: string[] } | "removed") => {
    const where = and(
      eq(schema.applicationMember.applicationId, "acme"),
      eq(schema.applicationMember.userId, user.id),
    )
    if (change === "removed") await h.ctx.db.delete(schema.applicationMember).where(where)
    else await h.ctx.db.update(schema.applicationMember).set(change).where(where)
  }

  const keys = async (app = "acme", principal = root) =>
    (await kitContext(h.ctx, principal, app)).services.user_keys

  const mint = async (overrides: { userId?: string; scopes?: string[]; expiresAt?: string } = {}) =>
    (await keys()).mint({ userId: user.id, name: "CLI token", scopes: ["invoices:read"], ...overrides })

  const validate = async (token: string, app = "acme") => (await keys(app)).validate({ token })
  const list = async () => (await (await keys()).list({})).keys

  it("mints a wak_ token and lists it without the secret", async () => {
    const minted = await mint()
    expect(minted.token.startsWith("wak_")).toBe(true)

    const [listed] = await list()
    expect(listed.id).toBe(minted.id)
    expect(listed.scopes).toEqual(["invoices:read"])
    expect(listed.status).toBe("active")
    expect(JSON.stringify(listed)).not.toContain(minted.token)
  })

  it("refuses to mint for an unknown user", async () => {
    expect(await failureOf(mint({ userId: "nobody" }))).toEqual({
      status: 404,
      error: "No user nobody.",
    })
  })

  it("rejects scopes the app never declared, naming them", async () => {
    expect(await failureOf(mint({ scopes: ["invoices:read", "nope:read"] }))).toEqual({
      status: 422,
      error: "Not in this app's catalog: nope:read",
    })
  })

  it("refuses scopes the owner doesn't hold in the app, naming them", async () => {
    await setMembership({ productPermissions: ["invoices:read"] })
    expect(await failureOf(mint({ scopes: ["invoices:read", "invoices:write"] }))).toEqual({
      status: 422,
      error: "The owner doesn't hold: invoices:write",
    })
    expect(await list()).toHaveLength(0)
  })

  it("refuses any scope for a user who isn't a member of the app", async () => {
    await setMembership("removed")
    expect(await failureOf(mint({ scopes: ["invoices:read"] }))).toEqual({
      status: 422,
      error: "The owner doesn't hold: invoices:read",
    })
  })

  it("lets an app admin's key carry any declared scope", async () => {
    await setMembership("removed")
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "admin" })
    expect(await mint({ scopes: CATALOG })).toMatchObject({ token: expect.any(String) })
  })

  it("validates a live key as kind user and returns its owner and scopes", async () => {
    const minted = await mint({ scopes: ["invoices:read", "invoices:write"] })
    expect(await validate(minted.token)).toMatchObject({
      valid: true,
      kind: "user",
      keyId: minted.id,
      userId: user.id,
      workspaceId: null,
      scopes: ["invoices:read", "invoices:write"],
      name: "CLI token",
    })
  })

  it("reports not_found for a key minted for another app", async () => {
    const minted = await mint()
    expect(await validate(minted.token, "other")).toEqual({ valid: false, reason: "not_found" })
  })

  it("reports not_found for a garbage token", async () => {
    expect(await validate("wak_nonsense")).toEqual({ valid: false, reason: "not_found" })
    // A token that isn't even ours is rejected without a database round-trip.
    expect(await validate("bearer-ish")).toEqual({ valid: false, reason: "not_found" })
  })

  it("reports revoked after revocation", async () => {
    const minted = await mint()
    await (await keys()).revoke({ id: minted.id })
    expect(await validate(minted.token)).toEqual({ valid: false, reason: "revoked" })
  })

  it("reports expired past the expiry", async () => {
    const minted = await mint({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect(await validate(minted.token)).toEqual({ valid: false, reason: "expired" })
  })

  it("refuses a key whose owner has left the app, logging why", async () => {
    const minted = await mint()
    await setMembership("removed")

    // The SDK's schema has no reason for this; `revoked` is the closest it reads.
    expect(await validate(minted.token)).toEqual({ valid: false, reason: "revoked" })
    expect(h.logs.find((l) => l.message === "userkey.owner_lost_access")?.fields).toMatchObject({
      keyId: minted.id,
      reason: "not_a_member",
    })
  })

  it("refuses a key whose owner no longer holds every scope, rather than shrinking it", async () => {
    const minted = await mint({ scopes: ["invoices:read", "invoices:write"] })
    await setMembership({ productPermissions: ["invoices:read"] })

    expect(await validate(minted.token)).toEqual({ valid: false, reason: "revoked" })
    expect(h.logs.find((l) => l.message === "userkey.owner_lost_access")?.fields).toMatchObject({
      keyId: minted.id,
      reason: "scopes_not_held",
    })
  })

  it("revokes idempotently and keeps the first revocation", async () => {
    const minted = await mint()
    const k = await keys()
    expect(await k.revoke({ id: minted.id })).toEqual({ ok: true })
    expect(await k.revoke({ id: minted.id })).toEqual({ ok: true })

    expect((await list())[0].status).toBe("revoked")
    const entries = await listAuditForApp(h.ctx, "acme")
    expect(entries.filter((e) => e.operation === "revoke")).toHaveLength(1)
  })

  it("refuses every operation to a caller holding the wrong userkey permission", async () => {
    const minted = await mint()
    // Holds the whole family *except* the one each call needs, so a 403 here is
    // about the specific permission and not about being a stranger to the app.
    const reader = await keys("acme", memberPrincipal("u1", "acme", ["userkey:read"]))

    expect((await failureOf(reader.mint({ userId: user.id, name: "nope" }))).status).toBe(403)
    expect((await failureOf(reader.revoke({ id: minted.id }))).status).toBe(403)
    expect((await failureOf(reader.validate({ token: minted.token }))).status).toBe(403)
    // The one it does hold still works.
    expect((await reader.list({})).keys).toHaveLength(1)
  })

  it("does not let a member of one app in to another: the app is a 404", async () => {
    const stranger = memberPrincipal("u1", "other", ["userkey:read"])
    expect((await failureOf(keys("acme", stranger))).status).toBe(404)
  })

  it("audits the mint and the revocation against the app, naming the key", async () => {
    const minted = await mint()
    await (await keys()).revoke({ id: minted.id })

    const entries = await listAuditForApp(h.ctx, "acme")
    expect(entries.map((e) => [e.tableName, e.operation, e.rowId])).toEqual([
      ["user_api_key", "revoke", minted.id],
      ["user_api_key", "create", minted.id],
    ])
    expect(entries[1].actor).toBe(root.id)
  })

  it("will not let one app revoke another app's key", async () => {
    await createApplication(h.ctx, { app: "other" })
    const minted = await mint()

    expect(await failureOf((await keys("other")).revoke({ id: minted.id }))).toEqual({
      status: 404,
      error: "Key not found.",
    })
    expect(await validate(minted.token)).toMatchObject({ valid: true })
  })

  it("hides app methods at the IdP level, and checks the output at the edge", async () => {
    const idp = await kitContext(h.ctx, root, null)
    expect((await failureOf(idp.services.user_keys.list({}))).status).toBe(404)

    // Through kit's HTTP surface the output is parsed by the SDK's schema.
    const ctx = await kitContext(h.ctx, root, "acme")
    await mint()
    const { app } = await import("../app/kit.server")
    const res = await app.handle(
      new Request("https://idp.willy.im/api/user_keys.list", { method: "POST", body: "{}" }),
      ctx,
    )
    expect(res?.status).toBe(200)
    expect((await res!.json()).keys[0]).not.toHaveProperty("keyHash")
  })
})

/**
 * Minting against a RESOURCE type. The app declares `kirby:thread` and where
 * to enumerate it; the IdP composes `<type>:<id>` grants and confirms each id
 * against that list at write time — so a key never carries a scope pointing at
 * a conversation bender doesn't have.
 */
describe("end-user API keys scoped to a resource instance", () => {
  let h: TestHarness
  let user: { id: string }
  let root: IdpPrincipal

  const THREAD = {
    type: "kirby:thread",
    label: "WhatsApp conversation",
    list: "https://bender.test/idp/resources/kirby-thread",
  }
  const FAMILIA = { id: "t_14f451b6", label: "Familia", description: null }

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, {
      app: "bender",
      permissions: ["kirby:read"],
      resourceTypes: [THREAD],
    })
    user = await createUser(h.ctx, { email: "willy@bender.test" })
    // An app admin holds `kirby:thread:*`, which covers every instance.
    await createMember(h.ctx, { app: "bender", userId: user.id, role: "admin" })
  })
  afterEach(() => h.close())

  const keys = async (resources: ResourceLister = stubResources({ "kirby:thread": [FAMILIA] })) =>
    (await kitContext(h.ctx, root, "bender", { resources })).services.user_keys
  const mint = async (scopes: string[], resources?: ResourceLister) =>
    (await keys(resources)).mint({ userId: user.id, name: "Kirby CLI", scopes })

  it("mints a key for one conversation and hands that exact scope back on validation", async () => {
    const minted = await mint(["kirby:thread:t_14f451b6"])

    // The composed string is what lands on the key — nothing downstream has to
    // learn a new shape, `grants()` already covers it with `kirby:*`.
    expect(await (await keys()).validate({ token: minted.token })).toMatchObject({
      valid: true,
      scopes: ["kirby:thread:t_14f451b6"],
    })
  })

  it("refuses an id the app does not currently list, naming the whole grant", async () => {
    expect(await failureOf(mint(["kirby:thread:t_nope"]))).toEqual({
      status: 422,
      error: "The app does not currently list: kirby:thread:t_nope",
    })
  })

  it("refuses a type the app never declared, before it would call anyone", async () => {
    // `artifacts:abc` reads like an instance grant, but nothing declares
    // `artifacts` — so it is a catalog miss, not a missing resource.
    expect(await failureOf(mint(["artifacts:abc"]))).toEqual({
      status: 422,
      error: "Not in this app's catalog: artifacts:abc",
    })
  })

  it("refuses to guess when the app's list can't be read: a 502", async () => {
    // Minting through a blind spot would hand out a scope nobody verified.
    const down = stubResources({ "kirby:thread": new Error("bender is down") })
    expect(await failureOf(mint(["kirby:thread:t_14f451b6"], down))).toEqual({
      status: 502,
      error: "Could not read the app's resource list for: kirby:thread",
    })
  })
})
