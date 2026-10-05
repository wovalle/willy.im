import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import * as schema from "../app/db/schema"
import { getApplication, listApplications } from "../app/lib/admin.server"
import { listAuditForApp } from "../app/lib/audit.server"
import type { IdpPrincipal } from "../app/lib/caller.server"
import { hashClientSecret } from "../app/lib/client-secret.server"
import {
  bootstrapAdminKey,
  createMember,
  createUser,
  failureOf,
  kitContext,
  signedInPrincipal,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * The application lifecycle (`applications.*`, `catalog.declare`) driven by a
 * bearer principal: nothing here touches a cookie session or a Better Auth
 * endpoint.
 */
describe("application lifecycle", () => {
  let h: TestHarness
  /** An IdP-level admin key, resolved through the real front-door path. */
  let root: IdpPrincipal

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    root = (await bootstrapAdminKey(h.ctx)).principal
  })
  afterEach(() => h.close())

  /** The services of `principal` in `tenant` (acme unless given; null for the IdP level). */
  const as = async (principal: IdpPrincipal = root, tenant: string | null = "acme") =>
    (await kitContext(h.ctx, principal, tenant)).services

  const register = async (
    overrides: { app?: string; redirectUris?: string[]; firstAdminUserId?: string | null } = {},
    principal: IdpPrincipal = root,
  ) =>
    (await as(principal, null)).applications.register({
      name: "Acme",
      app: "acme",
      redirectUris: ["https://acme.test/callback"],
      ...overrides,
    })

  const storedSecret = async (clientId: string) => {
    const [row] = await h.ctx.db
      .select({ clientSecret: schema.oauthClient.clientSecret })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, clientId))
    return row.clientSecret
  }

  describe("applications.register", () => {
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
      expect(row.applicationType).toBe("web")
      expect(row.tokenEndpointAuthMethod).toBe("client_secret_post")
      expect(row.grantTypes).toEqual(["authorization_code", "refresh_token"])
      expect(row.responseTypes).toEqual(["code"])
      expect(row.requirePKCE).toBe(true)

      expect(await (await as()).applications.get()).toMatchObject({
        clientId,
        app: "acme",
        name: "Acme",
        disabled: false,
      })
    })

    it("409s a second application on the same app key", async () => {
      await register()
      expect(await failureOf(register())).toEqual({
        status: 409,
        error: 'The app key "acme" is already taken.',
      })
      expect(await listApplications(h.ctx)).toHaveLength(1)
    })

    it("rejects a non-slug app key (400) and an unusable redirect URI (422)", async () => {
      const bad = await failureOf(register({ app: "Acme Corp" }))
      expect(bad.status).toBe(400)
      expect(await failureOf(register({ redirectUris: ["not-a-url"] }))).toEqual({
        status: 422,
        error: '"not-a-url" isn\'t a valid URL. Use an absolute URL like https://app.example.com/callback.',
      })
    })

    it("enrols the calling user as first admin by default", async () => {
      const boss = await createUser(h.ctx, { email: "super@willy.im" })
      const { app } = await register({}, await signedInPrincipal(h.ctx, boss))

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

    it("leaves the app memberless when the caller has no human behind it", async () => {
      // An admin key has no user, so there is nobody to enrol — the app starts
      // superadmin-managed until members are added explicitly.
      await register()
      expect(
        await h.ctx.db
          .select()
          .from(schema.applicationMember)
          .where(eq(schema.applicationMember.applicationId, "acme")),
      ).toEqual([])
    })

    it("audits the registration against the new app, naming the key", async () => {
      const { clientId } = await register()
      const [entry] = await listAuditForApp(h.ctx, "acme")
      expect(entry).toMatchObject({
        tableName: "oauth_client",
        operation: "create",
        rowId: clientId,
        actor: root.id,
        userId: null,
      })
    })
  })

  describe("mutations", () => {
    it("rotates the secret, invalidating the old one", async () => {
      const { clientId, clientSecret } = await register()
      const before = await storedSecret(clientId)

      const rotated = await (await as()).applications.rotate_secret()

      expect(rotated.clientSecret).not.toBe(clientSecret)
      const after = await storedSecret(clientId)
      expect(after).not.toBe(before)
      expect(after).toBe(await hashClientSecret(rotated.clientSecret))
      // The old plaintext no longer hashes to what's stored.
      expect(await hashClientSecret(clientSecret)).not.toBe(after)
    })

    it("patches name, redirects and signup in one go, leaving the rest", async () => {
      const { clientId } = await register()
      await (await as()).catalog.declare({ permissions: ["invoices:read"] })
      const updated = await (await as()).applications.update({
        name: "Acme Inc",
        redirectUris: ["https://acme.test/cb"],
        allowSignup: true,
      })

      expect(updated).toMatchObject({
        clientId,
        name: "Acme Inc",
        redirectUris: ["https://acme.test/cb"],
        allowSignup: true,
        permissions: ["invoices:read"],
        app: "acme",
      })
    })

    it("replaces the product-permission catalog", async () => {
      const { clientId } = await register()
      const next = await (await as()).catalog.declare({
        permissions: ["invoices:read", "invoices:write", "invoices:read"],
        resourceTypes: [],
      })

      expect(next).toEqual({ permissions: ["invoices:read", "invoices:write"], resourceTypes: [] })
      expect((await getApplication(h.ctx, clientId))!.permissions).toEqual([
        "invoices:read",
        "invoices:write",
      ])
    })

    it("422s a resource type whose list URL the IdP can't call", async () => {
      await register()
      const declare = (await as()).catalog.declare({
        permissions: [],
        resourceTypes: [{ type: "kirby:thread", list: "http://bender.test/list" }],
      })
      expect(await failureOf(declare)).toEqual({
        status: 422,
        error: "The list URL of kirby:thread isn't callable: http://bender.test/list",
      })
    })

    it("takes plain http on loopback, so a local app can be wired to a local IdP", async () => {
      await register()
      const declared = await (await as()).catalog.declare({
        permissions: [],
        resourceTypes: [{ type: "kirby:thread", list: "http://localhost:8484/x" }],
      })
      expect(declared.resourceTypes).toEqual([
        { type: "kirby:thread", label: "kirby:thread", list: "http://localhost:8484/x" },
      ])
    })

    it("labels an unlabelled resource type by its type, and a declare without types clears them", async () => {
      const { clientId } = await register()
      const services = await as()
      const list = "https://bender.test/idp/resources/kirby-thread"

      const declared = await services.catalog.declare({
        permissions: ["kirby:read"],
        resourceTypes: [{ type: "kirby:thread", list }],
      })
      expect(declared.resourceTypes).toEqual([
        { type: "kirby:thread", label: "kirby:thread", list },
      ])

      // A replace, not a merge.
      expect(await services.catalog.declare({ permissions: ["kirby:read"] })).toEqual({
        permissions: ["kirby:read"],
        resourceTypes: [],
      })
      expect((await getApplication(h.ctx, clientId))!.resourceTypes).toEqual([])
    })

    it("deletes the application, and then it's a 404", async () => {
      const { clientId } = await register()
      expect(await (await as()).applications.delete()).toEqual({ ok: true })

      expect(await getApplication(h.ctx, clientId)).toBeNull()
      expect((await failureOf((await as()).applications.get())).status).toBe(404)
    })

    it("audits every mutation with the caller's label", async () => {
      await register()
      const services = await as()
      await services.applications.rotate_secret()
      await services.applications.update({ redirectUris: ["https://acme.test/new"] })
      await services.applications.delete()

      const entries = await listAuditForApp(h.ctx, "acme")
      expect(entries.map((e) => e.operation)).toEqual(["delete", "update", "update", "create"])
      expect(entries.every((e) => e.actor === root.id)).toBe(true)
      expect(entries.every((e) => e.tableName === "oauth_client")).toBe(true)
    })
  })

  describe("authorization", () => {
    it("shuts out a signed-in user with no membership: the app is a 404, registering a 403", async () => {
      await register()
      const stranger = await createUser(h.ctx, { email: "stranger@elsewhere.test" })
      const principal = await signedInPrincipal(h.ctx, stranger)

      expect((await failureOf(as(principal))).status).toBe(404)
      // Registration is superadmin-only, whoever you are.
      expect((await failureOf(register({ app: "theirs" }, principal))).status).toBe(403)
      expect((await failureOf((await as(principal, null)).applications.list())).status).toBe(403)
    })

    it("lets app:update rotate and edit the catalog, but not delete", async () => {
      await register()
      const editor = await createUser(h.ctx, { email: "editor@acme.test" })
      await createMember(h.ctx, {
        app: "acme",
        userId: editor.id,
        role: "member",
        permissions: ["app:read", "app:update"],
      })
      const services = await as(await signedInPrincipal(h.ctx, editor))

      expect((await services.applications.rotate_secret()).clientSecret).toMatch(/^[a-zA-Z]{32}$/)
      expect(await services.catalog.declare({ permissions: ["x:read"] })).toMatchObject({
        permissions: ["x:read"],
      })
      expect((await failureOf(services.applications.delete())).status).toBe(403)
    })

    it("needs app:read to read the app and app:update to rotate its secret", async () => {
      await register()
      const servicesOf = async (email: string, permissions: string[]) => {
        const user = await createUser(h.ctx, { email })
        await createMember(h.ctx, { app: "acme", userId: user.id, role: "member", permissions })
        return as(await signedInPrincipal(h.ctx, user))
      }
      const reader = await servicesOf("reader@acme.test", ["app:read"])
      const membersOnly = await servicesOf("members@acme.test", ["member:read"])

      expect(await reader.applications.get()).toMatchObject({ app: "acme", name: "Acme" })
      expect((await failureOf(reader.applications.rotate_secret())).status).toBe(403)
      expect((await failureOf(membersOnly.applications.get())).status).toBe(403)
    })
  })

  /**
   * A resource URI is the audience of an app's access tokens, and the token
   * endpoint maps an audience back to exactly ONE owning app. Two apps declaring
   * the same URI would let a token be minted with the wrong app's permissions,
   * so the second declaration is refused. Same for a resource-type's list URL,
   * which the IdP signs a token for and GETs.
   */
  describe("cross-tenant resource claims", () => {
    beforeEach(async () => {
      await register()
      await register({ app: "other", redirectUris: ["https://other.test/callback"] })
    })

    it("refuses a resource URI already declared by another app", async () => {
      const uri = "https://acme.test/mcp"
      await (await as(root, "acme")).applications.update({ resources: [uri] })

      const clash = await failureOf(
        (await as(root, "other")).applications.update({ resources: [uri] }),
      )
      expect(clash.status).toBe(409)
      // The second app did not take the URI.
      expect((await (await as(root, "other")).applications.get()).resources).not.toContain(uri)
    })

    it("lets an app re-declare its own resource URI (idempotent)", async () => {
      const uri = "https://acme.test/mcp"
      await (await as(root, "acme")).applications.update({ resources: [uri] })
      await (await as(root, "acme")).applications.update({ resources: [uri] })
      expect((await (await as(root, "acme")).applications.get()).resources).toEqual([uri])
    })

    it("refuses a resource-type list URL already used by another app", async () => {
      const list = "https://acme.test/idp/resources/thread"
      await (await as(root, "acme")).catalog.declare({
        permissions: [],
        resourceTypes: [{ type: "thread", label: "Thread", list }],
      })

      const clash = await failureOf(
        (await as(root, "other")).catalog.declare({
          permissions: [],
          resourceTypes: [{ type: "thread", label: "Thread", list }],
        }),
      )
      expect(clash.status).toBe(409)
    })
  })
})
