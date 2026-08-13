import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createUserApiKey,
  listUserApiKeys,
  revokeUserApiKey,
  validateUserApiKey,
} from "../app/lib/user-api-keys.server"
import { createApplication, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * End-user API keys: minted by an app for one of its users, validated back
 * through the IdP. Scopes come from the app's declared product catalog.
 */
describe("end-user API keys", () => {
  let h: TestHarness
  let user: { id: string }

  const CATALOG = ["invoices:read", "invoices:write"]

  beforeEach(async () => {
    h = createTestHarness()
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    user = await createUser(h.ctx, { email: "enduser@acme.test" })
  })
  afterEach(() => h.close())

  const mint = (overrides: Partial<Parameters<typeof createUserApiKey>[1]> = {}) =>
    createUserApiKey(h.ctx, {
      app: "acme",
      userId: user.id,
      name: "CLI token",
      scopes: ["invoices:read"],
      ...overrides,
    })

  it("mints a wak_ token and lists it without the secret", async () => {
    const minted = await mint()
    expect("token" in minted).toBe(true)
    if (!("token" in minted)) return

    expect(minted.token.startsWith("wak_")).toBe(true)

    const [listed] = await listUserApiKeys(h.ctx, { app: "acme" })
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

    const result = await validateUserApiKey(h.ctx, { app: "acme", token: minted.token })
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

    expect(await validateUserApiKey(h.ctx, { app: "other", token: minted.token })).toEqual({
      valid: false,
      reason: "not_found",
    })
  })

  it("reports not_found for a garbage token", async () => {
    expect(await validateUserApiKey(h.ctx, { app: "acme", token: "wak_nonsense" })).toEqual({
      valid: false,
      reason: "not_found",
    })
    // A token that isn't even ours is rejected without a database round-trip.
    expect(await validateUserApiKey(h.ctx, { app: "acme", token: "bearer-ish" })).toEqual({
      valid: false,
      reason: "not_found",
    })
  })

  it("reports revoked after revocation", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")

    await revokeUserApiKey(h.ctx, { app: "acme", id: minted.id })
    expect(await validateUserApiKey(h.ctx, { app: "acme", token: minted.token })).toEqual({
      valid: false,
      reason: "revoked",
    })
  })

  it("reports expired past the expiry", async () => {
    const minted = await mint({ expiresAt: new Date(Date.now() - 1000) })
    if (!("token" in minted)) throw new Error("mint failed")

    expect(await validateUserApiKey(h.ctx, { app: "acme", token: minted.token })).toEqual({
      valid: false,
      reason: "expired",
    })
  })

  it("revokes idempotently and keeps the first revocation timestamp", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")

    expect(await revokeUserApiKey(h.ctx, { app: "acme", id: minted.id })).toEqual({ ok: true })
    const [first] = await listUserApiKeys(h.ctx, { app: "acme" })

    expect(await revokeUserApiKey(h.ctx, { app: "acme", id: minted.id })).toEqual({ ok: true })
    const [second] = await listUserApiKeys(h.ctx, { app: "acme" })

    expect(second.status).toBe("revoked")
    expect(second.revokedAt).toEqual(first.revokedAt)
  })

  it("will not let one app revoke another app's key", async () => {
    const minted = await mint()
    if (!("token" in minted)) throw new Error("mint failed")

    expect(await revokeUserApiKey(h.ctx, { app: "other", id: minted.id })).toEqual({
      error: "Key not found.",
    })
    expect(await validateUserApiKey(h.ctx, { app: "acme", token: minted.token })).toMatchObject({
      valid: true,
    })
  })
})
