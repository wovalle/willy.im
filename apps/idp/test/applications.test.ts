import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import * as schema from "../app/db/schema"
import {
  createApplication,
  deleteApplication,
  getApplication,
  listApplications,
  rotateApplicationSecret,
  updateApplication,
  updateApplicationPermissions,
  updateApplicationRedirectUris,
} from "../app/lib/admin.server"
import { listAuditForApp } from "../app/lib/audit.server"
import type { AuthService } from "../app/lib/auth.server"
import { resolveCaller, type Caller } from "../app/lib/caller.server"
import { hashClientSecret } from "../app/lib/client-secret.server"
import { bootstrapAdminKey, createMember, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Application lifecycle driven entirely by a bearer caller — the point of the
 * refactor. Nothing here touches a cookie session or a better-auth endpoint.
 */

/** The resolver only needs `api.getSession`; sessions aren't what's under test. */
function authStub(user: { id: string; email: string } | null): AuthService {
  return {
    api: { getSession: async () => (user ? { user, session: {} } : null) },
  } as unknown as AuthService
}

async function thrownStatus(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn()
    return 0
  } catch (err) {
    if (err instanceof Response) return err.status
    throw err
  }
}

describe("application lifecycle", () => {
  let h: TestHarness
  /** An IdP-level admin key, resolved through the real front-door path. */
  let root: Caller

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    root = (await bootstrapAdminKey(h.ctx)).caller
  })
  afterEach(() => h.close())

  const register = async (overrides: Partial<Parameters<typeof createApplication>[2]> = {}) => {
    const res = await createApplication(h.ctx, root, {
      name: "Acme",
      app: "acme",
      redirectUris: ["https://acme.test/callback"],
      ...overrides,
    })
    if ("error" in res) throw new Error(`unexpected ${res.error}`)
    return res
  }

  const storedSecret = async (clientId: string) => {
    const [row] = await h.ctx.db
      .select({ clientSecret: schema.oauthClient.clientSecret })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, clientId))
    return row.clientSecret
  }

  describe("createApplication", () => {
    it("registers a confidential web client the plugin would recognise", async () => {
      const { clientId, clientSecret, app } = await register()

      expect(app).toBe("acme")
      expect(clientId).toMatch(/^[a-zA-Z]{32}$/)
      expect(clientSecret).toMatch(/^[a-zA-Z]{32}$/)

      const [row] = await h.ctx.db
        .select()
        .from(schema.oauthClient)
        .where(eq(schema.oauthClient.clientId, clientId))
      expect(row.clientSecret).toBe(await hashClientSecret(clientSecret))
      expect(row.public).toBe(false)
      expect(row.type).toBe("web")
      expect(row.tokenEndpointAuthMethod).toBe("client_secret_basic")
      expect(row.grantTypes).toEqual(["authorization_code", "refresh_token"])
      expect(row.responseTypes).toEqual(["code"])
      expect(row.requirePKCE).toBe(true)

      const summary = await getApplication(h.ctx, clientId)
      expect(summary).toMatchObject({ app: "acme", name: "Acme", disabled: false })
    })

    it("refuses a second application on the same app key", async () => {
      await register()
      expect(await createApplication(h.ctx, root, {
        name: "Acme again",
        app: "acme",
        redirectUris: ["https://acme.test/callback"],
      })).toEqual({ error: "app_taken" })

      expect(await listApplications(h.ctx)).toHaveLength(1)
    })

    it("rejects a non-slug app key and an unusable redirect URI", async () => {
      const bad = await createApplication(h.ctx, root, {
        name: "Acme",
        app: "Acme Corp",
        redirectUris: ["https://acme.test/callback"],
      })
      expect(bad).toMatchObject({ error: "invalid_app" })

      const worse = await createApplication(h.ctx, root, {
        name: "Acme",
        app: "acme",
        redirectUris: ["not-a-url"],
      })
      expect(worse).toMatchObject({ error: "invalid_redirect_uri", detail: "not-a-url" })
    })

    it("enrols the calling user as first admin by default", async () => {
      const boss = await createUser(h.ctx, { email: "super@willy.im" })
      const session = (await resolveCaller(
        new Request("https://idp.willy.im/"),
        h.ctx,
        authStub(boss),
      ))!
      const { app } = await createApplication(h.ctx, session, {
        name: "Acme",
        app: "acme",
        redirectUris: ["https://acme.test/callback"],
      }).then((r) => ("error" in r ? Promise.reject(new Error(r.error)) : r))

      const members = await h.ctx.db
        .select()
        .from(schema.applicationMember)
        .where(eq(schema.applicationMember.applicationId, app))
      expect(members).toMatchObject([{ userId: boss.id, role: "admin" }])
    })

    it("enrols an explicit first admin", async () => {
      const owner = await createUser(h.ctx, { email: "owner@acme.test" })
      await register({ firstAdminUserId: owner.id })

      const members = await h.ctx.db
        .select()
        .from(schema.applicationMember)
        .where(eq(schema.applicationMember.applicationId, "acme"))
      expect(members).toMatchObject([{ userId: owner.id, role: "admin" }])
    })

    it("leaves the app memberless when the token caller has no human behind it", async () => {
      // The static admin token has no userId, so there is nobody to enrol — the
      // app starts superadmin-managed until members are added explicitly.
      await register()
      expect(
        await h.ctx.db
          .select()
          .from(schema.applicationMember)
          .where(eq(schema.applicationMember.applicationId, "acme")),
      ).toEqual([])
    })

    it("audits the registration against the token", async () => {
      const { clientId } = await register()
      const [entry] = await listAuditForApp(h.ctx, "acme")
      expect(entry).toMatchObject({
        tableName: "oauth_client",
        operation: "create",
        rowId: clientId,
        actor: `adminkey:${root.keyId}`,
        userId: null,
      })
    })
  })

  describe("mutations", () => {
    it("rotates the secret, invalidating the old one", async () => {
      const { clientId, clientSecret } = await register()
      const before = await storedSecret(clientId)

      const rotated = await rotateApplicationSecret(h.ctx, root, clientId)

      expect(rotated.clientSecret).not.toBe(clientSecret)
      const after = await storedSecret(clientId)
      expect(after).not.toBe(before)
      expect(after).toBe(await hashClientSecret(rotated.clientSecret))
      // The old plaintext no longer hashes to what's stored.
      expect(await hashClientSecret(clientSecret)).not.toBe(after)
    })

    it("replaces the redirect URIs", async () => {
      const { clientId } = await register()
      await updateApplicationRedirectUris(h.ctx, root, clientId, ["https://acme.test/new"])

      expect((await getApplication(h.ctx, clientId))!.redirectUris).toEqual([
        "https://acme.test/new",
      ])
    })

    it("patches name, redirects and signup in one go", async () => {
      const { clientId } = await register()
      const updated = await updateApplication(h.ctx, root, clientId, {
        name: "Acme Inc",
        redirectUris: ["https://acme.test/cb"],
        allowSignup: true,
      })

      expect(updated).toMatchObject({
        name: "Acme Inc",
        redirectUris: ["https://acme.test/cb"],
        allowSignup: true,
        app: "acme",
      })
    })

    it("replaces the product-permission catalog", async () => {
      const { clientId } = await register()
      const next = await updateApplicationPermissions(h.ctx, root, clientId, [
        "invoices:read",
        "invoices:write",
        "invoices:read",
      ])

      expect(next).toEqual(["invoices:read", "invoices:write"])
      expect((await getApplication(h.ctx, clientId))!.permissions).toEqual([
        "invoices:read",
        "invoices:write",
      ])
    })

    it("deletes the application", async () => {
      const { clientId } = await register()
      await deleteApplication(h.ctx, root, clientId)

      expect(await getApplication(h.ctx, clientId)).toBeNull()
    })

    it("audits every mutation with the caller's label", async () => {
      const { clientId } = await register()
      await rotateApplicationSecret(h.ctx, root, clientId)
      await updateApplicationRedirectUris(h.ctx, root, clientId, ["https://acme.test/new"])
      await deleteApplication(h.ctx, root, clientId)

      const entries = await listAuditForApp(h.ctx, "acme")
      expect(entries.map((e) => e.operation)).toEqual(["delete", "update", "update", "create"])
      expect(entries.every((e) => e.actor === `adminkey:${root.keyId}`)).toBe(true)
      expect(entries.every((e) => e.tableName === "oauth_client")).toBe(true)
    })
  })

  describe("authorization", () => {
    it("shuts out a signed-in user with no membership", async () => {
      const { clientId } = await register()
      const stranger = await createUser(h.ctx, { email: "stranger@elsewhere.test" })
      const caller = (await resolveCaller(
        new Request("https://idp.willy.im/"),
        h.ctx,
        authStub(stranger),
      ))!

      expect(await thrownStatus(() => rotateApplicationSecret(h.ctx, caller, clientId))).toBe(403)
      expect(
        await thrownStatus(() => updateApplicationRedirectUris(h.ctx, caller, clientId, ["https://x.test/cb"])),
      ).toBe(403)
      expect(await thrownStatus(() => updateApplication(h.ctx, caller, clientId, { name: "Nope" }))).toBe(403)
      expect(
        await thrownStatus(() => updateApplicationPermissions(h.ctx, caller, clientId, ["x:read"])),
      ).toBe(403)
      expect(await thrownStatus(() => deleteApplication(h.ctx, caller, clientId))).toBe(403)
      // Registration is superadmin-only, whoever you are.
      expect(
        await thrownStatus(() =>
          createApplication(h.ctx, caller, {
            name: "Theirs",
            app: "theirs",
            redirectUris: ["https://theirs.test/cb"],
          }),
        ),
      ).toBe(403)
    })

    it("lets app:update rotate but not delete", async () => {
      const { clientId } = await register()
      const editor = await createUser(h.ctx, { email: "editor@acme.test" })
      await createMember(h.ctx, {
        app: "acme",
        userId: editor.id,
        role: "member",
        permissions: ["app:read", "app:update"],
      })
      const caller = (await resolveCaller(
        new Request("https://idp.willy.im/"),
        h.ctx,
        authStub(editor),
      ))!

      const rotated = await rotateApplicationSecret(h.ctx, caller, clientId)
      expect(rotated.clientSecret).toMatch(/^[a-zA-Z]{32}$/)
      expect(await thrownStatus(() => deleteApplication(h.ctx, caller, clientId))).toBe(403)
    })
  })
})
