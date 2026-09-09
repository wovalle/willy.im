import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createUserApiKey,
  listUserApiKeys,
  revokeUserApiKey,
  validateUserApiKey,
} from "../app/lib/user-api-keys.server"
import { listAuditForApp } from "../app/lib/audit.server"
import type { Caller } from "../app/lib/caller.server"
import {
  bootstrapAdminKey,
  createApplication,
  createUser,
  fakeUserCaller,
  noResources,
  stubResources,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * End-user API keys: minted by an app for one of its users, validated back
 * through the IdP. Scopes come from the app's declared product catalog.
 */
describe("end-user API keys", () => {
  let h: TestHarness
  let user: { id: string }
  /** A real IdP-level admin key, resolved through the production resolver. */
  let root: Caller

  const CATALOG = ["invoices:read", "invoices:write"]

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).caller
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    user = await createUser(h.ctx, { email: "enduser@acme.test" })
  })
  afterEach(() => h.close())

  const mint = (overrides: Partial<Parameters<typeof createUserApiKey>[2]> = {}) =>
    createUserApiKey(h.ctx, root, {
      app: "acme",
      userId: user.id,
      name: "CLI token",
      scopes: ["invoices:read"],
      ...overrides,
    }, { resources: noResources })

  it("mints a wak_ token and lists it without the secret", async () => {
    const minted = await mint()
    expect("token" in minted).toBe(true)
    if (!("token" in minted)) return

    expect(minted.token.startsWith("wak_")).toBe(true)

    const [listed] = await listUserApiKeys(h.ctx, root, { app: "acme" })
    expect(listed.id).toBe(minted.id)
    expect(listed.scopes).toEqual(["invoices:read"])
    expect(listed.status).toBe("active")
    expect(JSON.stringify(listed)).not.toContain(minted.token)
  })

  it("refuses to mint for an unknown user", async () => {
    expect(await mint({ userId: "nobody" })).toEqual({ error: "unknown_user" })
  })

  it("rejects scopes the app never declared, naming them", async () => {
    expect(await mint({ scopes: ["invoices:read", "nope:read"] })).toEqual({
      error: "unknown_scopes",
      detail: ["nope:read"],
    })
  })

  it("validates a live key and returns its owner and scopes", async () => {
    const minted = await mint({ scopes: ["invoices:read", "invoices:write"] })
    if (!("token" in minted)) throw new Error("mint failed")

    const result = await validateUserApiKey(h.ctx, root, {
      app: "acme",
      token: minted.token,
    })
    expect(result).toMatchObject({
      valid: true,
      keyId: minted.id,
      userId: user.id,
      workspaceId: null,
      scopes: ["invoices:read", "invoices:write"],
      name: "CLI token",
    })
  })

  it("reports not_found for a key minted for another app", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")

    expect(
      await validateUserApiKey(h.ctx, root, { app: "other", token: minted.token }),
    ).toEqual({
      valid: false,
      reason: "not_found",
    })
  })

  it("reports not_found for a garbage token", async () => {
    expect(
      await validateUserApiKey(h.ctx, root, { app: "acme", token: "wak_nonsense" }),
    ).toEqual({
      valid: false,
      reason: "not_found",
    })
    // A token that isn't even ours is rejected without a database round-trip.
    expect(
      await validateUserApiKey(h.ctx, root, { app: "acme", token: "bearer-ish" }),
    ).toEqual({
      valid: false,
      reason: "not_found",
    })
  })

  it("reports revoked after revocation", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")

    await revokeUserApiKey(h.ctx, root, { app: "acme", id: minted.id })
    expect(
      await validateUserApiKey(h.ctx, root, { app: "acme", token: minted.token }),
    ).toEqual({
      valid: false,
      reason: "revoked",
    })
  })

  it("reports expired past the expiry", async () => {
    const minted = await mint({ expiresAt: new Date(Date.now() - 1000) })
    if (!("token" in minted)) throw new Error("mint failed")

    expect(
      await validateUserApiKey(h.ctx, root, { app: "acme", token: minted.token }),
    ).toEqual({
      valid: false,
      reason: "expired",
    })
  })

  it("revokes idempotently and keeps the first revocation timestamp", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")

    expect(
      await revokeUserApiKey(h.ctx, root, { app: "acme", id: minted.id }),
    ).toEqual({ ok: true })
    const [first] = await listUserApiKeys(h.ctx, root, { app: "acme" })

    expect(
      await revokeUserApiKey(h.ctx, root, { app: "acme", id: minted.id }),
    ).toEqual({ ok: true })
    const [second] = await listUserApiKeys(h.ctx, root, { app: "acme" })

    expect(second.status).toBe("revoked")
    expect(second.revokedAt).toEqual(first.revokedAt)
  })

  it("refuses every operation to a caller holding the wrong userkey permission", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")
    // Holds the whole family *except* the one each call needs, so a 403 here is
    // about the specific permission and not about being a stranger to the app.
    const reader = fakeUserCaller({ userId: "u1", app: "acme", permissions: ["userkey:read"] })

    await expect(
      createUserApiKey(h.ctx, reader, { app: "acme", userId: user.id, name: "nope" }, {
        resources: noResources,
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      revokeUserApiKey(h.ctx, reader, { app: "acme", id: minted.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      validateUserApiKey(h.ctx, reader, { app: "acme", token: minted.token }),
    ).rejects.toMatchObject({ status: 403 })
    // The one it does hold still works.
    expect(await listUserApiKeys(h.ctx, reader, { app: "acme" })).toHaveLength(1)
  })

  it("refuses to list keys for an app the caller has no permissions on", async () => {
    const reader = fakeUserCaller({ userId: "u1", app: "other", permissions: ["userkey:read"] })
    await expect(listUserApiKeys(h.ctx, reader, { app: "acme" })).rejects.toMatchObject({
      status: 403,
    })
  })

  it("audits the mint and the revocation against the app", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")
    await revokeUserApiKey(h.ctx, root, { app: "acme", id: minted.id })

    const entries = await listAuditForApp(h.ctx, "acme")
    expect(entries.map((e) => [e.tableName, e.operation, e.rowId])).toEqual([
      ["user_api_key", "revoke", minted.id],
      ["user_api_key", "create", minted.id],
    ])
    expect(entries[1].actor).toBe(`adminkey:${root.keyId}`)
  })

  it("will not let one app revoke another app's key", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")

    expect(
      await revokeUserApiKey(h.ctx, root, { app: "other", id: minted.id }),
    ).toEqual({
      error: "Key not found.",
    })
    expect(
      await validateUserApiKey(h.ctx, root, { app: "acme", token: minted.token }),
    ).toMatchObject({
      valid: true,
    })
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
  let root: Caller

  const THREAD = {
    type: "kirby:thread",
    label: "WhatsApp conversation",
    list: "https://bender.test/idp/resources/kirby-thread",
  }
  const FAMILIA = { id: "t_14f451b6", label: "Familia", description: null }

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).caller
    await createApplication(h.ctx, {
      app: "bender",
      permissions: ["kirby:read"],
      resourceTypes: [THREAD],
    })
    user = await createUser(h.ctx, { email: "willy@bender.test" })
  })
  afterEach(() => h.close())

  const mint = (scopes: string[], resources = stubResources({ "kirby:thread": [FAMILIA] })) =>
    createUserApiKey(
      h.ctx,
      root,
      { app: "bender", userId: user.id, name: "Kirby CLI", scopes },
      { resources },
    )

  it("mints a key for one conversation and hands that exact scope back on validation", async () => {
    const minted = await mint(["kirby:thread:t_14f451b6"])
    if (!("token" in minted)) throw new Error(`mint failed: ${JSON.stringify(minted)}`)

    // The composed string is what lands on the key — nothing downstream has to
    // learn a new shape, `grants()` already covers it with `kirby:*`.
    expect(
      await validateUserApiKey(h.ctx, root, { app: "bender", token: minted.token }),
    ).toMatchObject({ valid: true, scopes: ["kirby:thread:t_14f451b6"] })
  })

  it("refuses an id the app does not currently list, naming the whole grant", async () => {
    expect(await mint(["kirby:thread:t_nope"])).toEqual({
      error: "unknown_resource",
      detail: ["kirby:thread:t_nope"],
    })
  })

  it("refuses a type the app never declared, before it would call anyone", async () => {
    // `artifacts:abc` reads like an instance grant, but nothing declares
    // `artifacts` — so it is a catalog miss, not a missing resource.
    expect(await mint(["artifacts:abc"])).toEqual({
      error: "unknown_scopes",
      detail: ["artifacts:abc"],
    })
  })

  it("refuses to guess when the app's list can't be read", async () => {
    // Minting through a blind spot would hand out a scope nobody verified.
    const down = stubResources({ "kirby:thread": new Error("bender is down") })
    expect(await mint(["kirby:thread:t_14f451b6"], down)).toEqual({
      error: "resource_lookup_failed",
      detail: ["kirby:thread"],
    })
  })
})
