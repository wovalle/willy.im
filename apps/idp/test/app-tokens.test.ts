import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as schema from "../app/db/schema"
import { revokeAdminKey } from "../app/lib/api-keys.server"
import { createAppToken } from "../app/lib/app-tokens.server"
import { listAuditForApp } from "../app/lib/audit.server"
import type { AuthService } from "../app/lib/auth.server"
import { resolveCaller, type Caller } from "../app/lib/caller.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import { validateKey } from "../app/lib/user-api-keys.server"
import {
  bearerRequest,
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  mintAdminKey,
  mintApiKey,
  noResources,
  signedInCaller,
  stubResources,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * App tokens: a superadmin's authority, exchanged for a short-lived token bound
 * to one app — GitHub-App style, so the admin key itself never reaches an app.
 * The app validates the token through the same door as a user key, as
 * `kind: "app"`, and it is only ever as good as whoever issued it.
 */

const sessionless = {
  api: { getSession: async () => null },
} as unknown as AuthService

/** Gates and services signal failure by throwing a Response; normalise both. */
async function thrown(fn: () => Promise<unknown>): Promise<Response | null> {
  try {
    await fn()
    return null
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }
}

const MINUTE = 60_000

describe("app tokens", () => {
  let h: TestHarness
  /** The admin key every token here is minted with, unless a test says otherwise. */
  let root: { id: string; caller: Caller }

  const THREAD = {
    type: "kirby:thread",
    label: "Conversation",
    list: "https://acme.test/idp/resources/kirby-thread",
  }

  beforeEach(async () => {
    // Only the clock is faked, so a token's hour can pass inside a test.
    vi.useFakeTimers({ now: new Date("2026-06-01T00:00:00.000Z"), toFake: ["Date"] })
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    root = await bootstrapAdminKey(h.ctx, { name: "claude-code" })
    await createApplication(h.ctx, {
      app: "acme",
      permissions: ["invoices:read", "invoices:write"],
      resourceTypes: [THREAD],
    })
    await createApplication(h.ctx, { app: "other" })
  })
  afterEach(() => {
    h.close()
    vi.useRealTimers()
  })

  const later = (ms: number) => vi.setSystemTime(Date.now() + ms)
  const present = (token: string) => resolveCaller(bearerRequest(token), h.ctx, sessionless)

  const mint = (
    input: Partial<Parameters<typeof createAppToken>[2]> = {},
    caller: Caller = root.caller,
    resources = noResources,
  ) => createAppToken(h.ctx, caller, { app: "acme", ...input }, { resources })

  /** `mint`, failing the test on an error result. */
  const minted = async (...args: Parameters<typeof mint>) => {
    const res = await mint(...args)
    if ("error" in res) throw new Error(`mint failed: ${JSON.stringify(res)}`)
    return res
  }

  /** Validation as the app asks for it: through `validateKey`, with its own key. */
  const validate = (token: string, app = "acme") => validateKey(h.ctx, root.caller, { app, token })

  describe("minting", () => {
    it('mints a wat_ token holding ["*"] for an hour by default, storing only its hash', async () => {
      const token = await minted()

      expect(token.token.startsWith("wat_")).toBe(true)
      expect(token.prefix).toBe(token.token.slice(0, 12))
      expect(token.scopes).toEqual(["*"])
      expect(token.workspaceId).toBeNull()
      expect(token.expiresAt).toEqual(new Date("2026-06-01T01:00:00.000Z"))

      const rows = await h.ctx.db.select().from(schema.appToken)
      expect(rows).toHaveLength(1)
      expect(JSON.stringify(rows)).not.toContain(token.token)
    })

    it("prunes tokens more than a day past their expiry when minting, and keeps the rest", async () => {
      const old = await minted()
      later(25 * 60 * 60 * 1000) // its hour, then a day more
      const recent = await minted({ expiresIn: 60 })
      later(2 * 60 * 1000) // `recent` has expired too, but only just
      await minted()

      const ids = (await h.ctx.db.select({ id: schema.appToken.id }).from(schema.appToken)).map(
        (r) => r.id,
      )
      expect(ids).not.toContain(old.id)
      expect(ids).toContain(recent.id)
      expect(ids).toHaveLength(2)
    })

    it("records exactly one issuer: the admin key, or the admin who signed in", async () => {
      const admin = await createUser(h.ctx, { email: "super@willy.im" })
      const byKey = await minted()
      const bySession = await minted({}, await signedInCaller(h.ctx, admin))

      const issuers = await h.ctx.db
        .select({
          id: schema.appToken.id,
          keyId: schema.appToken.issuedByKeyId,
          userId: schema.appToken.issuedByUserId,
        })
        .from(schema.appToken)
      expect(issuers.find((r) => r.id === byKey.id)).toEqual({
        id: byKey.id,
        keyId: root.id,
        userId: null,
      })
      expect(issuers.find((r) => r.id === bySession.id)).toEqual({
        id: bySession.id,
        keyId: null,
        userId: admin.id,
      })
    })

    it('narrows to declared permissions and listed instances, "*" allowed among them', async () => {
      const listed = stubResources({
        "kirby:thread": [{ id: "t_1", label: "Familia", description: null }],
      })
      const narrowed = await minted(
        { scopes: ["invoices:read", "kirby:thread:t_1"], workspaceId: "ws_1" },
        root.caller,
        listed,
      )
      expect(narrowed.scopes).toEqual(["invoices:read", "kirby:thread:t_1"])
      expect(narrowed.workspaceId).toBe("ws_1")

      expect((await minted({ scopes: ["*"] })).scopes).toEqual(["*"])
    })

    it("rejects scopes the app never declared or doesn't list, naming them, and mints nothing", async () => {
      expect(await mint({ scopes: ["invoices:read", "nope:read"] })).toEqual({
        error: "unknown_scopes",
        detail: ["nope:read"],
      })
      expect(
        await mint(
          { scopes: ["kirby:thread:t_gone"] },
          root.caller,
          stubResources({ "kirby:thread": [] }),
        ),
      ).toEqual({ error: "unknown_resource", detail: ["kirby:thread:t_gone"] })

      expect(await h.ctx.db.select().from(schema.appToken)).toEqual([])
    })

    it("lives as long as asked, within the hour", async () => {
      const token = await minted({ expiresIn: 60 })
      expect(token.expiresAt).toEqual(new Date("2026-06-01T00:01:00.000Z"))
    })

    it("answers not_found for an app that isn't registered", async () => {
      expect(await mint({ app: "ghost" })).toEqual({ error: "not_found" })
    })

    it("refuses an app-scoped key or a member session, however privileged on the app", async () => {
      const scoped = await mintApiKey(
        h.ctx,
        { app: "acme", permissions: [...APP_PERMISSIONS] },
        root.caller,
      )
      const appAdmin = await createUser(h.ctx, { email: "admin@acme.test" })
      await createMember(h.ctx, { app: "acme", userId: appAdmin.id, role: "admin" })

      for (const caller of [
        (await present(scoped.token))!,
        await signedInCaller(h.ctx, appAdmin),
      ]) {
        const res = await thrown(() => mint({}, caller))
        expect(res?.status).toBe(403)
        expect(await res!.json()).toEqual({ error: "forbidden" })
      }
      expect(await h.ctx.db.select().from(schema.appToken)).toEqual([])
    })
  })

  describe("validating", () => {
    it("validates as kind app, naming the admin key that issued it", async () => {
      const token = await minted({ workspaceId: "ws_1" })

      expect(await validate(token.token)).toEqual({
        valid: true,
        kind: "app",
        keyId: token.id,
        issuedBy: `adminkey:${root.id}`,
        workspaceId: "ws_1",
        scopes: ["*"],
        name: "claude-code",
      })
    })

    it("validates a token minted from an admin session, naming the admin by email", async () => {
      const admin = await createUser(h.ctx, { email: "super@willy.im" })
      const token = await minted({}, await signedInCaller(h.ctx, admin))

      expect(await validate(token.token)).toMatchObject({
        valid: true,
        kind: "app",
        issuedBy: `user:${admin.id}`,
        name: "super@willy.im",
      })
    })

    it("reports expired once its time is up", async () => {
      const token = await minted({ expiresIn: 60 })

      later(59_000)
      expect(await validate(token.token)).toMatchObject({ valid: true })
      later(1_000)
      expect(await validate(token.token)).toEqual({ valid: false, reason: "expired" })
    })

    it("reports revoked once the issuing admin key is revoked, logging why", async () => {
      const agent = await mintAdminKey(h.ctx, { name: "Agent" }, root.caller)
      const token = await minted({}, (await present(agent.token))!)
      expect(await validate(token.token)).toMatchObject({ valid: true, name: "Agent" })

      await revokeAdminKey(h.ctx, root.caller, agent.id)
      expect(await validate(token.token)).toEqual({ valid: false, reason: "revoked" })
      expect(h.logs.find((l) => l.message === "apptoken.issuer_lost_access")?.fields).toEqual({
        keyId: token.id,
        issuedBy: `adminkey:${agent.id}`,
        reason: "key_revoked",
      })
    })

    it("reports revoked once the issuing admin key expires, even with the token's hour left", async () => {
      const agent = await mintAdminKey(
        h.ctx,
        { expiresAt: new Date(Date.now() + 30 * MINUTE) },
        root.caller,
      )
      const token = await minted({}, (await present(agent.token))!)

      later(30 * MINUTE)
      expect(await validate(token.token)).toEqual({ valid: false, reason: "revoked" })
      expect(h.logs.find((l) => l.message === "apptoken.issuer_lost_access")?.fields).toEqual({
        keyId: token.id,
        issuedBy: `adminkey:${agent.id}`,
        reason: "key_expired",
      })
    })

    it("reports revoked once the issuing admin leaves the allowlist", async () => {
      const admin = await createUser(h.ctx, { email: "super@willy.im" })
      const token = await minted({}, await signedInCaller(h.ctx, admin))

      process.env.ADMIN_EMAILS = "someone-else@willy.im"
      expect(await validate(token.token)).toEqual({ valid: false, reason: "revoked" })
      expect(h.logs.find((l) => l.message === "apptoken.issuer_lost_access")?.fields).toEqual({
        keyId: token.id,
        issuedBy: `user:${admin.id}`,
        reason: "not_an_admin",
      })
    })

    it("reports not_found for a token minted for another app, or one never minted", async () => {
      const token = await minted()

      expect(await validate(token.token, "other")).toEqual({ valid: false, reason: "not_found" })
      expect(await validate("wat_nonsense")).toEqual({ valid: false, reason: "not_found" })
    })
  })

  it("audits the issue against the app, naming the admin key and what it carries", async () => {
    const token = await minted({ scopes: ["invoices:read"], workspaceId: "ws_1" })

    expect(await listAuditForApp(h.ctx, "acme")).toMatchObject([
      { tableName: "app_token", operation: "issue", rowId: token.id, actor: `adminkey:${root.id}` },
    ])
    const [entry] = await h.ctx.db
      .select({ after: schema.auditLog.new_data })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.row_id, token.id))
    expect(JSON.parse(entry.after!)).toEqual({
      scopes: ["invoices:read"],
      workspaceId: "ws_1",
      expiresAt: "2026-06-01T01:00:00.000Z",
    })
  })
})
