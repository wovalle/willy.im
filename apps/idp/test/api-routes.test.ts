import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createApplication } from "../app/lib/admin.server"
import type { AuthService } from "../app/lib/auth.server"
import { resolveCaller, type Caller } from "../app/lib/caller.server"
import * as applications from "../app/routes/api/applications"
import * as application from "../app/routes/api/applications.$clientId"
import * as rotateSecret from "../app/routes/api/applications.$clientId.rotate-secret"
import * as appKeys from "../app/routes/api/apps.$app.keys"
import * as appKey from "../app/routes/api/apps.$app.keys.$id"
import * as appMembers from "../app/routes/api/apps.$app.members"
import * as appPermissions from "../app/routes/api/apps.$app.permissions"
import * as appUserKeys from "../app/routes/api/apps.$app.user-keys"
import { createMember, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Route-level smoke: status + body for each family's interesting outcomes. The
 * handlers are called directly with a Request and a context, which is all a
 * resource route ever touches — no router, no Workers runtime.
 */

const ADMIN_TOKEN = "super-secret-admin-token"

function authStub(user: { id: string; email: string } | null): AuthService {
  return {
    api: { getSession: async () => (user ? { user, session: {} } : null) },
  } as unknown as AuthService
}

describe("management API routes", () => {
  let h: TestHarness
  let context: Record<string, unknown>
  let acme: { clientId: string; app: string }
  let root: Caller

  /** Handlers signal failure by throwing a Response; normalise both paths. */
  const call = async (
    handler: (args: never) => unknown,
    args: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> => {
    try {
      const res = (await handler({ context, ...args } as never)) as Response
      return { status: res.status, body: await res.json() }
    } catch (err) {
      if (!(err instanceof Response)) throw err
      return { status: err.status, body: await err.json() }
    }
  }

  const request = (url: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
    new Request(`https://idp.willy.im${url}`, {
      method: init.method ?? "GET",
      ...(init.token ? { headers: { authorization: `Bearer ${init.token}` } } : {}),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })

  beforeEach(async () => {
    h = createTestHarness({
      env: { ADMIN_EMAILS: "super@willy.im", ADMIN_API_TOKEN: ADMIN_TOKEN },
    })
    context = { ...h.ctx, services: { auth: authStub(null) }, cloudflare: {} }
    root = (await resolveCaller(request("/", { token: ADMIN_TOKEN }), h.ctx, authStub(null)))!
    const created = await createApplication(h.ctx, root, {
      name: "Acme",
      app: "acme",
      redirectUris: ["https://acme.test/cb"],
    })
    if ("error" in created) throw new Error(created.error)
    acme = { clientId: created.clientId, app: created.app }
  })
  afterEach(() => h.close())

  /** A member of `acme` holding exactly `permissions`, as a signed-in caller. */
  const asMember = async (permissions: string[]) => {
    const user = await createUser(h.ctx, { email: `m${permissions.length}@acme.test` })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member", permissions })
    context = { ...h.ctx, services: { auth: authStub(user) }, cloudflare: {} }
    return user
  }

  describe("/api/v1/applications", () => {
    it("401s without a bearer token", async () => {
      const res = await call(applications.action, {
        request: request("/api/v1/applications", { method: "POST", body: {} }),
      })
      expect(res).toEqual({ status: 401, body: { error: "unauthorized" } })
    })

    it("403s a caller who isn't a superadmin", async () => {
      await asMember(["app:read", "app:update"])
      const res = await call(applications.action, {
        request: request("/api/v1/applications", {
          method: "POST",
          body: { name: "Theirs", app: "theirs", redirectUris: ["https://theirs.test/cb"] },
        }),
      })
      expect(res).toEqual({ status: 403, body: { error: "forbidden" } })
    })

    it("201s with the one-time client secret", async () => {
      const res = await call(applications.action, {
        request: request("/api/v1/applications", {
          method: "POST",
          token: ADMIN_TOKEN,
          body: { name: "Invoices", app: "invoices", redirectUris: ["https://inv.test/cb"] },
        }),
      })
      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({ app: "invoices" })
      expect((res.body as { clientSecret: string }).clientSecret).toMatch(/^[a-zA-Z]{32}$/)
    })

    it("409s a duplicate app key", async () => {
      const res = await call(applications.action, {
        request: request("/api/v1/applications", {
          method: "POST",
          token: ADMIN_TOKEN,
          body: { name: "Acme 2", app: "acme", redirectUris: ["https://acme.test/cb"] },
        }),
      })
      expect(res).toEqual({ status: 409, body: { error: "app_taken" } })
    })

    it("422s a body the schema rejects", async () => {
      const res = await call(applications.action, {
        request: request("/api/v1/applications", {
          method: "POST",
          token: ADMIN_TOKEN,
          body: { name: "No key", redirectUris: [] },
        }),
      })
      expect(res.status).toBe(422)
      expect(res.body).toMatchObject({ error: "validation_error" })
    })

    it("405s a method the resource doesn't serve", async () => {
      const res = await call(applications.action, {
        request: request("/api/v1/applications", { method: "PUT", token: ADMIN_TOKEN }),
      })
      expect(res).toEqual({ status: 405, body: { error: "method_not_allowed" } })
    })
  })

  describe("/api/v1/applications/{clientId}", () => {
    it("200s the summary for a caller with app:read", async () => {
      await asMember(["app:read"])
      const res = await call(application.loader, {
        request: request(`/api/v1/applications/${acme.clientId}`),
        params: { clientId: acme.clientId },
      })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ clientId: acme.clientId, app: "acme", name: "Acme" })
    })

    it("403s a caller without app:read", async () => {
      await asMember(["member:read"])
      const res = await call(application.loader, {
        request: request(`/api/v1/applications/${acme.clientId}`),
        params: { clientId: acme.clientId },
      })
      expect(res).toEqual({ status: 403, body: { error: "forbidden" } })
    })

    it("404s an unknown client id", async () => {
      const res = await call(application.loader, {
        request: request("/api/v1/applications/nope", { token: ADMIN_TOKEN }),
        params: { clientId: "nope" },
      })
      expect(res).toEqual({ status: 404, body: { error: "not_found" } })
    })

    it("200s a PATCH and 200s a DELETE", async () => {
      const patched = await call(application.action, {
        request: request(`/api/v1/applications/${acme.clientId}`, {
          method: "PATCH",
          token: ADMIN_TOKEN,
          body: { name: "Acme Inc", allowSignup: true },
        }),
        params: { clientId: acme.clientId },
      })
      expect(patched.status).toBe(200)
      expect(patched.body).toMatchObject({ name: "Acme Inc", allowSignup: true })

      const deleted = await call(application.action, {
        request: request(`/api/v1/applications/${acme.clientId}`, {
          method: "DELETE",
          token: ADMIN_TOKEN,
        }),
        params: { clientId: acme.clientId },
      })
      expect(deleted).toEqual({ status: 200, body: { ok: true } })
    })

    it("405s POST", async () => {
      const res = await call(application.action, {
        request: request(`/api/v1/applications/${acme.clientId}`, {
          method: "POST",
          token: ADMIN_TOKEN,
        }),
        params: { clientId: acme.clientId },
      })
      expect(res).toEqual({ status: 405, body: { error: "method_not_allowed" } })
    })
  })

  describe("/api/v1/applications/{clientId}/rotate-secret", () => {
    it("200s a fresh secret", async () => {
      const res = await call(rotateSecret.action, {
        request: request(`/api/v1/applications/${acme.clientId}/rotate-secret`, {
          method: "POST",
          token: ADMIN_TOKEN,
        }),
        params: { clientId: acme.clientId },
      })
      expect(res.status).toBe(200)
      expect((res.body as { clientSecret: string }).clientSecret).toMatch(/^[a-zA-Z]{32}$/)
    })

    it("403s a caller without app:update", async () => {
      await asMember(["app:read"])
      const res = await call(rotateSecret.action, {
        request: request(`/api/v1/applications/${acme.clientId}/rotate-secret`, {
          method: "POST",
        }),
        params: { clientId: acme.clientId },
      })
      expect(res).toEqual({ status: 403, body: { error: "forbidden" } })
    })

    it("405s GET-shaped use", async () => {
      const res = await call(rotateSecret.action, {
        request: request(`/api/v1/applications/${acme.clientId}/rotate-secret`, {
          token: ADMIN_TOKEN,
        }),
        params: { clientId: acme.clientId },
      })
      expect(res).toEqual({ status: 405, body: { error: "method_not_allowed" } })
    })
  })

  describe("/api/v1/apps/{app}/permissions", () => {
    it("200s the replaced catalog", async () => {
      const res = await call(appPermissions.action, {
        request: request("/api/v1/apps/acme/permissions", {
          method: "PUT",
          token: ADMIN_TOKEN,
          body: { permissions: ["invoices:read", "invoices:write"] },
        }),
        params: { app: "acme" },
      })
      expect(res).toEqual({
        status: 200,
        body: { permissions: ["invoices:read", "invoices:write"] },
      })
    })

    it("404s an app that isn't registered", async () => {
      const res = await call(appPermissions.action, {
        request: request("/api/v1/apps/ghost/permissions", {
          method: "PUT",
          token: ADMIN_TOKEN,
          body: { permissions: [] },
        }),
        params: { app: "ghost" },
      })
      expect(res).toEqual({ status: 404, body: { error: "not_found" } })
    })

    it("405s POST", async () => {
      const res = await call(appPermissions.action, {
        request: request("/api/v1/apps/acme/permissions", {
          method: "POST",
          token: ADMIN_TOKEN,
        }),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 405, body: { error: "method_not_allowed" } })
    })
  })

  describe("/api/v1/apps/{app}/keys", () => {
    it("201s a key and lists it back without the hash", async () => {
      const created = await call(appKeys.action, {
        request: request("/api/v1/apps/acme/keys", {
          method: "POST",
          token: ADMIN_TOKEN,
          body: { name: "CI", permissions: ["member:read"] },
        }),
        params: { app: "acme" },
      })
      expect(created.status).toBe(201)
      const token = (created.body as { token: string }).token
      expect(token.startsWith("wim_")).toBe(true)

      const listed = await call(appKeys.loader, {
        request: request("/api/v1/apps/acme/keys", { token: ADMIN_TOKEN }),
        params: { app: "acme" },
      })
      expect(listed.status).toBe(200)
      expect(JSON.stringify(listed.body)).not.toContain(token)
      expect((listed.body as { keys: unknown[] }).keys).toHaveLength(1)
    })

    it("403s a caller minting beyond its own permissions", async () => {
      await asMember(["apikey:create", "member:read"])
      const res = await call(appKeys.action, {
        request: request("/api/v1/apps/acme/keys", {
          method: "POST",
          body: { name: "Escalation", permissions: ["member:read", "member:manage"] },
        }),
        params: { app: "acme" },
      })
      expect(res).toEqual({
        status: 403,
        body: { error: "permissions_exceed_caller", detail: ["member:manage"] },
      })
    })

    it("401s an anonymous list", async () => {
      const res = await call(appKeys.loader, {
        request: request("/api/v1/apps/acme/keys"),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 401, body: { error: "unauthorized" } })
    })

    it("405s DELETE on the collection", async () => {
      const res = await call(appKeys.action, {
        request: request("/api/v1/apps/acme/keys", { method: "DELETE", token: ADMIN_TOKEN }),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 405, body: { error: "method_not_allowed" } })
    })
  })

  describe("/api/v1/apps/{app}/members", () => {
    const invite = { email: "new@acme.test", role: "member", permissions: [] }

    it("401s an anonymous invite before the service runs", async () => {
      const res = await call(appMembers.action, {
        request: request("/api/v1/apps/acme/members", { method: "POST", body: invite }),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 401, body: { error: "unauthorized" } })
    })

    it("403s a caller who can read members but not invite them", async () => {
      await asMember(["member:read"])
      const res = await call(appMembers.action, {
        request: request("/api/v1/apps/acme/members", { method: "POST", body: invite }),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 403, body: { error: "forbidden" } })
    })

    it("201s an invite from a caller holding member:invite", async () => {
      await asMember(["member:invite"])
      const res = await call(appMembers.action, {
        request: request("/api/v1/apps/acme/members", { method: "POST", body: invite }),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 201, body: { result: "invited" } })
    })
  })

  describe("/api/v1/apps/{app}/user-keys", () => {
    it("401s an anonymous list before the service runs", async () => {
      const res = await call(appUserKeys.loader, {
        request: request("/api/v1/apps/acme/user-keys"),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 401, body: { error: "unauthorized" } })
    })

    it("403s a caller without userkey:read", async () => {
      await asMember(["userkey:create"])
      const res = await call(appUserKeys.loader, {
        request: request("/api/v1/apps/acme/user-keys"),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 403, body: { error: "forbidden" } })
    })

    it("200s an empty list for a caller holding userkey:read", async () => {
      await asMember(["userkey:read"])
      const res = await call(appUserKeys.loader, {
        request: request("/api/v1/apps/acme/user-keys"),
        params: { app: "acme" },
      })
      expect(res).toEqual({ status: 200, body: { keys: [] } })
    })
  })

  describe("/api/v1/apps/{app}/keys/{id}", () => {
    const mint = async () => {
      const created = await call(appKeys.action, {
        request: request("/api/v1/apps/acme/keys", {
          method: "POST",
          token: ADMIN_TOKEN,
          body: { name: "CI", permissions: ["member:read"] },
        }),
        params: { app: "acme" },
      })
      return (created.body as { id: string }).id
    }

    it("200s a revoke", async () => {
      const id = await mint()
      const res = await call(appKey.action, {
        request: request(`/api/v1/apps/acme/keys/${id}`, {
          method: "DELETE",
          token: ADMIN_TOKEN,
        }),
        params: { app: "acme", id },
      })
      expect(res).toEqual({ status: 200, body: { ok: true } })
    })

    it("404s an id this app doesn't own", async () => {
      const res = await call(appKey.action, {
        request: request("/api/v1/apps/acme/keys/ghost", {
          method: "DELETE",
          token: ADMIN_TOKEN,
        }),
        params: { app: "acme", id: "ghost" },
      })
      expect(res).toEqual({ status: 404, body: { error: "not_found" } })
    })

    it("405s GET", async () => {
      const res = await call(appKey.action, {
        request: request("/api/v1/apps/acme/keys/whatever", { token: ADMIN_TOKEN }),
        params: { app: "acme", id: "whatever" },
      })
      expect(res).toEqual({ status: 405, body: { error: "method_not_allowed" } })
    })
  })
})
