import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  requireApiPrincipal,
  requireSuperadminApi,
  revokeApiKey,
} from "../app/lib/api-keys.server"
import { bearerRequest, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/** Full lifecycle of a scoped management key: mint → authenticate → gate. */
describe("scoped management API keys", () => {
  let h: TestHarness
  let creator: { id: string }

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_API_TOKEN: "super-secret-admin-token" } })
    creator = await createUser(h.ctx, { email: "creator@acme.test" })
  })
  afterEach(() => h.close())

  const mint = (overrides: Partial<Parameters<typeof createApiKey>[1]> = {}) =>
    createApiKey(h.ctx, {
      app: "acme",
      name: "CI runner",
      permissions: ["member:read", "member:invite"],
      createdByUserId: creator.id,
      ...overrides,
    })

  it("returns the plaintext token exactly once and never stores it", async () => {
    const { token, prefix, id } = await mint()

    expect(token.startsWith("wim_")).toBe(true)
    expect(prefix).toBe(token.slice(0, 12))

    const [listed] = await listApiKeys(h.ctx, "acme")
    expect(listed.id).toBe(id)
    expect(JSON.stringify(listed)).not.toContain(token)
    expect(listed.status).toBe("active")
  })

  it("drops permissions that are not in the management catalog", async () => {
    await mint({ permissions: ["member:read", "not:a-real-permission"] })
    const [listed] = await listApiKeys(h.ctx, "acme")
    expect(listed.permissions).toEqual(["member:read"])
  })

  it("authenticates a live key and reports its granted permissions", async () => {
    const { token, id } = await mint()
    const principal = await authenticateApiKey(bearerRequest(token), h.ctx)

    expect(principal).not.toBeNull()
    expect(principal!.kind).toBe("key")
    expect(principal!.applicationId).toBe("acme")
    expect(principal!.keyId).toBe(id)
    expect(principal!.can("acme", "member:read")).toBe(true)
    expect(principal!.can("acme", "app:delete")).toBe(false)
  })

  it("refuses a key against an application it is not bound to", async () => {
    const { token } = await mint()
    const principal = await authenticateApiKey(bearerRequest(token), h.ctx)
    expect(principal!.can("other", "member:read")).toBe(false)
  })

  it("refuses a revoked key", async () => {
    const { token, id } = await mint()
    expect(await revokeApiKey(h.ctx, { app: "acme", id })).toEqual({ ok: true })

    expect(await authenticateApiKey(bearerRequest(token), h.ctx)).toBeNull()
    const [listed] = await listApiKeys(h.ctx, "acme")
    expect(listed.status).toBe("revoked")
  })

  it("refuses an expired key", async () => {
    const { token } = await mint({ expiresAt: new Date(Date.now() - 1000) })
    expect(await authenticateApiKey(bearerRequest(token), h.ctx)).toBeNull()
  })

  it("will not let one app revoke another app's key", async () => {
    const { token, id } = await mint()
    expect(await revokeApiKey(h.ctx, { app: "other", id })).toEqual({ error: "Key not found." })
    expect(await authenticateApiKey(bearerRequest(token), h.ctx)).not.toBeNull()
  })

  it("refuses an unknown or malformed token", async () => {
    expect(await authenticateApiKey(bearerRequest("wim_nope"), h.ctx)).toBeNull()
    expect(await authenticateApiKey(bearerRequest("not-even-ours"), h.ctx)).toBeNull()
    expect(await authenticateApiKey(new Request("https://idp.willy.im/"), h.ctx)).toBeNull()
  })

  it("authenticates the static superadmin token for every app", async () => {
    const principal = await authenticateApiKey(bearerRequest("super-secret-admin-token"), h.ctx)
    expect(principal!.kind).toBe("superadmin")
    expect(principal!.can("literally-anything", "app:delete")).toBe(true)
  })
})

describe("requireApiPrincipal", () => {
  let h: TestHarness
  let creator: { id: string }

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_API_TOKEN: "super-secret-admin-token" } })
    creator = await createUser(h.ctx, { email: "creator@acme.test" })
  })
  afterEach(() => h.close())

  const mint = () =>
    createApiKey(h.ctx, {
      app: "acme",
      name: "CI runner",
      permissions: ["member:read"],
      createdByUserId: creator.id,
    })

  /** The gates throw Responses; unwrap the status for readable assertions. */
  const statusOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      return 200
    } catch (thrown) {
      if (thrown instanceof Response) return thrown.status
      throw thrown
    }
  }

  it("401s without a bearer token", async () => {
    expect(await statusOf(() => requireApiPrincipal(new Request("https://idp.willy.im/"), h.ctx))).toBe(401)
  })

  it("passes a key holding the required permission", async () => {
    const { token } = await mint()
    const principal = await requireApiPrincipal(bearerRequest(token), h.ctx, {
      app: "acme",
      permission: "member:read",
    })
    expect(principal.kind).toBe("key")
  })

  it("403s a key missing the required permission", async () => {
    const { token } = await mint()
    expect(
      await statusOf(() =>
        requireApiPrincipal(bearerRequest(token), h.ctx, { app: "acme", permission: "app:delete" }),
      ),
    ).toBe(403)
  })

  it("403s a key used against a different application", async () => {
    const { token } = await mint()
    expect(
      await statusOf(() =>
        requireApiPrincipal(bearerRequest(token), h.ctx, { app: "other", permission: "member:read" }),
      ),
    ).toBe(403)
  })

  it("reserves cross-app endpoints for the superadmin token", async () => {
    const { token } = await mint()
    expect(await statusOf(() => requireSuperadminApi(bearerRequest(token), h.ctx))).toBe(403)
    expect(
      await statusOf(() => requireSuperadminApi(bearerRequest("super-secret-admin-token"), h.ctx)),
    ).toBe(200)
  })
})
