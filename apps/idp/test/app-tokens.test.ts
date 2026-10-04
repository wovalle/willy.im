import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as schema from "../app/db/schema"
import { listAuditForApp } from "../app/lib/audit.server"
import type { AuthService } from "../app/lib/auth.server"
import { principalFrom, type IdpPrincipal } from "../app/lib/caller.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import {
  bearerRequest,
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  failureOf,
  kitContext,
  mintAdminKey,
  mintApiKey,
  noResources,
  signedInPrincipal,
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

const MINUTE = 60_000

describe("app tokens", () => {
  let h: TestHarness
  /** The admin key every token here is minted with, unless a test says otherwise. */
  let root: Awaited<ReturnType<typeof bootstrapAdminKey>>

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
  const present = (token: string) => principalFrom(bearerRequest(token), h.ctx, sessionless)

  /** `app_tokens.mint` in `app` (acme unless given), as `principal`. */
  const mint = async (
    { app = "acme", ...input }: { app?: string; scopes?: string[]; workspaceId?: string; expiresIn?: number } = {},
    principal: IdpPrincipal = root.principal,
    resources = noResources,
  ) => (await kitContext(h.ctx, principal, app, { resources })).services.app_tokens.mint(input)
  const minted = mint

  /** Validation as the app asks for it: `user_keys.validate` in the app. */
  const validate = async (token: string, app = "acme") =>
    (await kitContext(h.ctx, root.principal, app)).services.user_keys.validate({ token })

  describe("minting", () => {
    it('mints a wat_ token holding ["*"] for an hour by default, storing only its hash', async () => {
      const token = await minted()

      expect(token.token.startsWith("wat_")).toBe(true)
      expect(token.prefix).toBe(token.token.slice(0, 12))
      expect(token.scopes).toEqual(["*"])
      expect(token.workspaceId).toBeNull()
      expect(token.expiresAt).toBe("2026-06-01T01:00:00.000Z")

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
      const bySession = await minted({}, await signedInPrincipal(h.ctx, admin))

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
        root.principal,
        listed,
      )
      expect(narrowed.scopes).toEqual(["invoices:read", "kirby:thread:t_1"])
      expect(narrowed.workspaceId).toBe("ws_1")

      expect((await minted({ scopes: ["*"] })).scopes).toEqual(["*"])
    })

    it("rejects scopes the app never declared or doesn't list, naming them, and mints nothing", async () => {
      expect(await failureOf(mint({ scopes: ["invoices:read", "nope:read"] }))).toEqual({
        status: 422,
        error: "Not in this app's catalog: nope:read",
      })
      expect(
        await failureOf(
          mint({ scopes: ["kirby:thread:t_gone"] }, root.principal, stubResources({ "kirby:thread": [] })),
        ),
      ).toEqual({ status: 422, error: "The app does not currently list: kirby:thread:t_gone" })

      expect(await h.ctx.db.select().from(schema.appToken)).toEqual([])
    })

    it("lives as long as asked, within the hour", async () => {
      const token = await minted({ expiresIn: 60 })
      expect(token.expiresAt).toBe("2026-06-01T00:01:00.000Z")
    })

    it("400s an expiresIn outside 60–3600 seconds, naming the field, and mints nothing", async () => {
      for (const expiresIn of [59, 3601, 90.5]) {
        const refused = await mint({ expiresIn }).catch((e: unknown) => e)
        expect(refused).toBeInstanceOf(Response)
        expect((refused as Response).status).toBe(400)
        expect(await (refused as Response).json()).toMatchObject({
          fields: { expiresIn: [expect.any(String)] },
        })
      }
      expect(await h.ctx.db.select().from(schema.appToken)).toEqual([])
    })

    it("404s an app that isn't registered", async () => {
      expect(await failureOf(mint({ app: "ghost" }))).toEqual({ status: 404, error: "No application ghost." })
    })

    it("refuses an app-scoped key or a member session, however privileged on the app", async () => {
      const scoped = await mintApiKey(
        h.ctx,
        { app: "acme", permissions: [...APP_PERMISSIONS] },
        root.principal,
      )
      const appAdmin = await createUser(h.ctx, { email: "admin@acme.test" })
      await createMember(h.ctx, { app: "acme", userId: appAdmin.id, role: "admin" })

      for (const principal of [
        (await present(scoped.token))!,
        await signedInPrincipal(h.ctx, appAdmin),
      ])
        expect((await failureOf(mint({}, principal))).status).toBe(403)
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
      const token = await minted({}, await signedInPrincipal(h.ctx, admin))

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
      const agent = await mintAdminKey(h.ctx, { name: "Agent" }, root.principal)
      const token = await minted({}, (await present(agent.token))!)
      expect(await validate(token.token)).toMatchObject({ valid: true, name: "Agent" })

      await (await kitContext(h.ctx, root.principal, null)).services.admin_keys.revoke({ id: agent.id })
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
        root.principal,
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
      const token = await minted({}, await signedInPrincipal(h.ctx, admin))

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
