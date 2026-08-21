import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createApiKey, listApiKeys, revokeApiKey } from "../app/lib/api-keys.server"
import { listAuditForApp } from "../app/lib/audit.server"
import type { Caller } from "../app/lib/caller.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import { createUser, fakeUserCaller, tokenSuperadmin } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Minting, listing and revoking scoped management keys. Resolving a presented
 * token to a caller lives in caller.test.ts — this file is only the store.
 */
describe("scoped management API keys", () => {
  let h: TestHarness
  let creator: { id: string }

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_API_TOKEN: "super-secret-admin-token" } })
    creator = await createUser(h.ctx, { email: "creator@acme.test" })
  })
  afterEach(() => h.close())

  /** The console's path: a signed-in app admin mints the key. */
  const admin = (): Caller =>
    fakeUserCaller({
      userId: creator.id,
      app: "acme",
      permissions: ["apikey:create", "apikey:read", "apikey:revoke", "member:read", "member:invite"],
    })

  const mint = (
    overrides: Partial<Parameters<typeof createApiKey>[2]> = {},
    caller: Caller = admin(),
  ) =>
    createApiKey(h.ctx, caller, {
      app: "acme",
      name: "CI runner",
      permissions: ["member:read", "member:invite"],
      ...overrides,
    })

  /** Unwraps the success branch — most cases here aren't about the error union. */
  const mintOk = async (overrides: Partial<Parameters<typeof createApiKey>[2]> = {}) => {
    const res = await mint(overrides)
    if ("error" in res) throw new Error(`unexpected ${res.error}`)
    return res
  }

  const list = (app = "acme") => listApiKeys(h.ctx, tokenSuperadmin(), app)

  it("returns the plaintext token exactly once and never stores it", async () => {
    const { token, prefix, id } = await mintOk()

    expect(token.startsWith("wim_")).toBe(true)
    expect(prefix).toBe(token.slice(0, 12))

    const [listed] = await list()
    expect(listed.id).toBe(id)
    expect(JSON.stringify(listed)).not.toContain(token)
    expect(listed.status).toBe("active")
  })

  it("drops permissions that are not in the management catalog", async () => {
    await mintOk({ permissions: ["member:read", "not:a-real-permission"] })
    const [listed] = await list()
    expect(listed.permissions).toEqual(["member:read"])
  })

  it("marks a revoked key revoked, idempotently", async () => {
    const { id } = await mintOk()
    expect(await revokeApiKey(h.ctx, admin(), { app: "acme", id })).toEqual({ ok: true })
    expect(await revokeApiKey(h.ctx, admin(), { app: "acme", id })).toEqual({ ok: true })

    const [listed] = await list()
    expect(listed.status).toBe("revoked")
  })

  it("reports a past expiry as expired", async () => {
    await mintOk({ expiresAt: new Date(Date.now() - 1000) })
    const [listed] = await list()
    expect(listed.status).toBe("expired")
  })

  it("will not let one app revoke another app's key", async () => {
    const { id } = await mintOk()
    expect(await revokeApiKey(h.ctx, tokenSuperadmin(), { app: "other", id })).toEqual({ error: "Key not found." })

    const [listed] = await list()
    expect(listed.id).toBe(id)
    expect(listed.status).toBe("active")
  })

  it("accepts a machine caller — the static admin token has no user behind it", async () => {
    const res = await mint({}, tokenSuperadmin())
    if ("error" in res) throw new Error(res.error)
    const [listed] = await list()
    expect(listed.id).toBe(res.id)
  })

  it("records the creator on the row and an audit entry with the caller's label", async () => {
    const { id } = await mintOk()

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
    const { id } = await mintOk()
    await revokeApiKey(h.ctx, admin(), { app: "acme", id })
    await revokeApiKey(h.ctx, admin(), { app: "acme", id })

    const revokes = (await listAuditForApp(h.ctx, "acme")).filter((e) => e.operation === "revoke")
    expect(revokes).toHaveLength(1)
    expect(revokes[0]).toMatchObject({ tableName: "api_key", rowId: id })
  })

  describe("permission escalation", () => {
    /** A key that may mint keys, and holds exactly one other permission. */
    const minter = (): Caller =>
      fakeUserCaller({
        userId: creator.id,
        app: "acme",
        permissions: ["apikey:create", "member:read"],
      })

    it("lets a caller grant a subset of what it holds", async () => {
      const res = await mint({ permissions: ["member:read"] }, minter())
      expect("token" in res).toBe(true)
    })

    it("refuses to mint permissions the caller doesn't hold", async () => {
      const res = await mint({ permissions: ["member:read", "member:manage"] }, minter())
      expect(res).toEqual({ error: "permissions_exceed_caller", detail: ["member:manage"] })

      // Nothing was written — a rejected mint leaves no key behind.
      expect(await list()).toHaveLength(0)
    })

    it("lets a superadmin mint anything", async () => {
      const res = await mint({ permissions: [...APP_PERMISSIONS] }, tokenSuperadmin())
      if ("error" in res) throw new Error(res.error)

      const [listed] = await list()
      expect(listed.permissions).toEqual([...APP_PERMISSIONS])
    })

    it("403s a caller without apikey:create before it looks at the permissions", async () => {
      const powerless = fakeUserCaller({ userId: creator.id, app: "acme", permissions: [] })
      const failure = await mint({ permissions: [] }, powerless).catch((e: unknown) => e)

      expect(failure).toBeInstanceOf(Response)
      expect((failure as Response).status).toBe(403)
    })
  })
})
