import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createAdminKey,
  listAdminKeys,
  listApiKeys,
  revokeAdminKey,
  revokeApiKey,
} from "../app/lib/api-keys.server"
import { IDP_AUDIT_SCOPE, listAuditForApp } from "../app/lib/audit.server"
import type { AuthService } from "../app/lib/auth.server"
import { resolveCaller, type Caller } from "../app/lib/caller.server"
import { APP_PERMISSIONS } from "../app/lib/permissions"
import * as adminKeyRoute from "../app/routes/api/admin-keys"
import * as adminKeyIdRoute from "../app/routes/api/admin-keys.$id"
import {
  bearerRequest,
  createApplication,
  createUser,
  fakeUserCaller,
  mintAdminKey,
  mintApiKey,
  tokenSuperadmin,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * IdP-level admin keys. The interesting claim is not "the row is written" but
 * "the minted token comes back out of `resolveCaller` as a superadmin with a
 * name" — so most of these mint a key and then present it like a client would.
 */

const ADMIN_TOKEN = "super-secret-admin-token"

function authStub(user: { id: string; email: string } | null): AuthService {
  return {
    api: { getSession: async () => (user ? { user, session: {} } : null) },
  } as unknown as AuthService
}

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

describe("admin keys", () => {
  let h: TestHarness
  beforeEach(async () => {
    h = createTestHarness({
      env: { ADMIN_EMAILS: "super@willy.im", ADMIN_API_TOKEN: ADMIN_TOKEN },
    })
    await createApplication(h.ctx, { app: "acme" })
  })
  afterEach(() => h.close())

  /** The caller the static break-glass token resolves to, via the real resolver. */
  const staticTokenCaller = async () =>
    (await resolveCaller(bearerRequest(ADMIN_TOKEN), h.ctx, authStub(null)))!

  const present = (token: string) => resolveCaller(bearerRequest(token), h.ctx, authStub(null))

  describe("minting and presenting", () => {
    it("mints a key the resolver accepts as a named superadmin", async () => {
      const root = await staticTokenCaller()
      const created = await createAdminKey(h.ctx, root, { name: "Agent alpha" })
      expect(created.token.startsWith("wim_")).toBe(true)
      expect(created.prefix).toBe(created.token.slice(0, 12))

      const caller = (await present(created.token))!
      expect(caller.kind).toBe("superadmin")
      expect(caller.keyId).toBe(created.id)
      expect(caller.applicationId).toBeNull()
      expect(caller.actor).toEqual({ userId: null, label: `adminkey:${created.id}` })
      expect(await caller.can("literally-anything", "app:delete")).toBe(true)
      expect(await caller.permissionsFor("some-app")).toEqual([...APP_PERMISSIONS])
    })

    it("lets an admin key mint another admin key", async () => {
      const first = await mintAdminKey(h.ctx, { name: "Agent alpha" })
      const asFirst = (await present(first.token))!

      const second = await createAdminKey(h.ctx, asFirst, { name: "Agent beta" })
      const asSecond = (await present(second.token))!
      expect(asSecond.kind).toBe("superadmin")
      expect(asSecond.keyId).toBe(second.id)
    })

    it("lists admin keys without ever exposing a hash", async () => {
      await mintAdminKey(h.ctx, { name: "Agent alpha" })
      const keys = await listAdminKeys(h.ctx, await staticTokenCaller())
      expect(keys).toHaveLength(1)
      expect(keys[0]).toMatchObject({ name: "Agent alpha", status: "active", permissions: [] })
      expect(JSON.stringify(keys)).not.toContain("keyHash")
    })

    it("keeps admin keys out of an app's key list", async () => {
      await mintAdminKey(h.ctx)
      await mintApiKey(h.ctx, { app: "acme", name: "Scoped" })
      const appKeys = await listApiKeys(h.ctx, tokenSuperadmin(), "acme")
      expect(appKeys.map((k) => k.name)).toEqual(["Scoped"])
    })
  })

  describe("revocation and expiry", () => {
    it("stops authenticating once revoked", async () => {
      const { token, id } = await mintAdminKey(h.ctx)
      expect(await present(token)).not.toBeNull()

      expect(await revokeAdminKey(h.ctx, await staticTokenCaller(), id)).toEqual({ ok: true })
      expect(await present(token)).toBeNull()
    })

    it("is idempotent on a second revoke", async () => {
      const { id } = await mintAdminKey(h.ctx)
      const root = await staticTokenCaller()
      await revokeAdminKey(h.ctx, root, id)
      expect(await revokeAdminKey(h.ctx, root, id)).toEqual({ ok: true })
    })

    it("reports an unknown id as not found", async () => {
      const res = await revokeAdminKey(h.ctx, await staticTokenCaller(), "nope")
      expect(res).toEqual({ error: "Key not found." })
    })

    it("lets a key revoke itself, loudly", async () => {
      const { token, id } = await mintAdminKey(h.ctx)
      const self = (await present(token))!

      expect(await revokeAdminKey(h.ctx, self, id)).toEqual({ ok: true })
      expect(h.logs.filter((l) => l.message === "adminkey.self_revoke")).toHaveLength(1)
      // An agent that cleans up after itself has genuinely locked itself out.
      expect(await present(token)).toBeNull()
    })

    it("stops authenticating once expired", async () => {
      const { token } = await mintAdminKey(h.ctx, { expiresAt: new Date(Date.now() - 1000) })
      expect(await present(token)).toBeNull()
    })

    it("reports expiry in the listing", async () => {
      await mintAdminKey(h.ctx, { expiresAt: new Date(Date.now() - 1000) })
      const [key] = await listAdminKeys(h.ctx, await staticTokenCaller())
      expect(key.status).toBe("expired")
    })
  })

  describe("who may manage them", () => {
    it("refuses a signed-in human, however privileged on an app", async () => {
      const user = fakeUserCaller({
        userId: "u1",
        app: "acme",
        permissions: [...APP_PERMISSIONS],
      })
      const { id } = await mintAdminKey(h.ctx)

      for (const call of [
        () => listAdminKeys(h.ctx, user),
        () => createAdminKey(h.ctx, user, { name: "Nope" }),
        () => revokeAdminKey(h.ctx, user, id),
      ]) {
        const res = await thrown(call)
        expect(res?.status).toBe(403)
        expect(await res!.json()).toEqual({ error: "forbidden" })
      }
    })

    it("refuses an app-scoped key holding every app permission", async () => {
      const scoped = await mintApiKey(h.ctx, { app: "acme", permissions: [...APP_PERMISSIONS] })
      const caller = (await present(scoped.token))!
      expect(caller.kind).toBe("key")
      const { id } = await mintAdminKey(h.ctx)

      for (const call of [
        () => listAdminKeys(h.ctx, caller),
        () => createAdminKey(h.ctx, caller, { name: "Escalation" }),
        () => revokeAdminKey(h.ctx, caller, id),
      ]) {
        expect((await thrown(call))?.status).toBe(403)
      }
    })

    it("does not let an app-scoped revoke reach an admin key by id", async () => {
      const admin = await mintAdminKey(h.ctx)
      const res = await revokeApiKey(h.ctx, tokenSuperadmin(), { app: "acme", id: admin.id })
      expect(res).toEqual({ error: "Key not found." })
      // Still very much alive.
      expect(await present(admin.token)).not.toBeNull()
    })
  })

  describe("audit trail", () => {
    it("records the mint under the IdP scope", async () => {
      const created = await createAdminKey(h.ctx, await staticTokenCaller(), { name: "Agent" })
      const entries = await listAuditForApp(h.ctx, IDP_AUDIT_SCOPE)
      expect(entries).toMatchObject([
        { tableName: "api_key", operation: "create", rowId: created.id, actor: "superadmin-token" },
      ])
    })

    it("names the admin key that acted, not just 'a superadmin'", async () => {
      const first = await mintAdminKey(h.ctx, { name: "Agent alpha" })
      const asFirst = (await present(first.token))!
      const second = await createAdminKey(h.ctx, asFirst, { name: "Agent beta" })
      await revokeAdminKey(h.ctx, asFirst, second.id)

      const entries = await listAuditForApp(h.ctx, IDP_AUDIT_SCOPE)
      expect(entries.filter((e) => e.actor === `adminkey:${first.id}`)).toMatchObject([
        { operation: "revoke", rowId: second.id },
        { operation: "create", rowId: second.id },
      ])
    })

    it("keeps IdP-level rows out of an app's audit view", async () => {
      await mintAdminKey(h.ctx)
      expect(await listAuditForApp(h.ctx, "acme")).toEqual([])
    })
  })

  describe("routes", () => {
    let context: Record<string, unknown>

    const call = async (
      handler: (args: never) => unknown,
      args: Record<string, unknown>,
    ): Promise<{ status: number; body: unknown; headers: Headers }> => {
      try {
        const res = (await handler({ context, ...args } as never)) as Response
        return { status: res.status, body: await res.json(), headers: res.headers }
      } catch (err) {
        if (!(err instanceof Response)) throw err
        return { status: err.status, body: await err.json(), headers: err.headers }
      }
    }

    const request = (
      url: string,
      init: { method?: string; token?: string; body?: unknown } = {},
    ) =>
      new Request(`https://idp.willy.im${url}`, {
        method: init.method ?? "GET",
        ...(init.token ? { headers: { authorization: `Bearer ${init.token}` } } : {}),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })

    beforeEach(() => {
      context = { ...h.ctx, services: { auth: authStub(null) }, cloudflare: {} }
    })

    it("401s without a bearer token", async () => {
      const res = await call(adminKeyRoute.loader, { request: request("/api/v1/admin-keys") })
      expect(res).toMatchObject({ status: 401, body: { error: "unauthorized" } })
    })

    it("403s a signed-in non-superadmin", async () => {
      const user = await createUser(h.ctx, { email: "member@acme.test" })
      context = { ...h.ctx, services: { auth: authStub(user) }, cloudflare: {} }
      const res = await call(adminKeyRoute.loader, { request: request("/api/v1/admin-keys") })
      expect(res).toMatchObject({ status: 403, body: { error: "forbidden" } })
    })

    it("403s an app-scoped key", async () => {
      const scoped = await mintApiKey(h.ctx, { app: "acme", permissions: [...APP_PERMISSIONS] })
      const res = await call(adminKeyRoute.loader, {
        request: request("/api/v1/admin-keys", { token: scoped.token }),
      })
      expect(res).toMatchObject({ status: 403, body: { error: "forbidden" } })
    })

    it("201s with the plaintext token exactly once", async () => {
      const res = await call(adminKeyRoute.action, {
        request: request("/api/v1/admin-keys", {
          method: "POST",
          token: ADMIN_TOKEN,
          body: { name: "Agent alpha" },
        }),
      })
      expect(res.status).toBe(201)
      const body = res.body as { id: string; token: string; prefix: string }
      expect(body.token.startsWith("wim_")).toBe(true)

      // The token works, and the listing never shows it again.
      expect((await present(body.token))!.keyId).toBe(body.id)
      const list = await call(adminKeyRoute.loader, {
        request: request("/api/v1/admin-keys", { token: ADMIN_TOKEN }),
      })
      expect(list.status).toBe(200)
      expect(JSON.stringify(list.body)).not.toContain(body.token)
      expect(list.body).toMatchObject({ keys: [{ id: body.id, name: "Agent alpha" }] })
    })

    it("422s a body with no name", async () => {
      const res = await call(adminKeyRoute.action, {
        request: request("/api/v1/admin-keys", {
          method: "POST",
          token: ADMIN_TOKEN,
          body: { name: "" },
        }),
      })
      expect(res.status).toBe(422)
    })

    it("200s a delete and 404s an unknown id", async () => {
      const { id } = await mintAdminKey(h.ctx)
      const ok = await call(adminKeyIdRoute.action, {
        request: request(`/api/v1/admin-keys/${id}`, { method: "DELETE", token: ADMIN_TOKEN }),
        params: { id },
      })
      expect(ok).toMatchObject({ status: 200, body: { ok: true } })

      const missing = await call(adminKeyIdRoute.action, {
        request: request("/api/v1/admin-keys/nope", { method: "DELETE", token: ADMIN_TOKEN }),
        params: { id: "nope" },
      })
      expect(missing).toMatchObject({ status: 404, body: { error: "not_found" } })
    })

    it("405s an unsupported method, saying what it does allow", async () => {
      const collection = await call(adminKeyRoute.action, {
        request: request("/api/v1/admin-keys", { method: "PATCH", token: ADMIN_TOKEN }),
      })
      expect(collection.status).toBe(405)
      expect(collection.headers.get("Allow")).toBe("GET, POST")

      const item = await call(adminKeyIdRoute.action, {
        request: request("/api/v1/admin-keys/x", { method: "POST", token: ADMIN_TOKEN }),
        params: { id: "x" },
      })
      expect(item.status).toBe(405)
      expect(item.headers.get("Allow")).toBe("DELETE")
    })
  })
})
