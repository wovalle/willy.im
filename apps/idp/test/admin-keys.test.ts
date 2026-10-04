import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { IDP_AUDIT_SCOPE, listAuditForApp } from "../app/lib/audit.server"
import type { AuthService } from "../app/lib/auth.server"
import { principalFrom, type IdpPrincipal } from "../app/lib/caller.server"
import { APP_PERMISSIONS, appRbac } from "../app/lib/permissions"
import * as adminKeyRoute from "../app/routes/api/admin-keys"
import * as adminKeyIdRoute from "../app/routes/api/admin-keys.$id"
import {
  bearerRequest,
  bootstrapAdminKey,
  createApplication,
  createUser,
  failureOf,
  kitContext,
  memberPrincipal,
  mintAdminKey,
  mintApiKey,
} from "./helpers/fixtures"
import { createTestHarness, routerContext, type TestHarness } from "./helpers/harness"

/**
 * IdP-level admin keys (`admin_keys.*`). The interesting claim is not "the row
 * is written" but "the minted token comes back out of `principalFrom` as a
 * superadmin with a name" — so most of these mint a key and then present it
 * like a client would.
 */

function authStub(user: { id: string; email: string } | null): AuthService {
  return {
    api: { getSession: async () => (user ? { user, session: {} } : null) },
  } as unknown as AuthService
}

describe("admin keys", () => {
  let h: TestHarness
  /**
   * The break-glass key, written straight into `api_key` — the documented way
   * back in when every admin key is lost, and the only bootstrap there is now
   * that no static token exists.
   */
  let root: Awaited<ReturnType<typeof bootstrapAdminKey>>

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    root = await bootstrapAdminKey(h.ctx)
    await createApplication(h.ctx, { app: "acme" })
  })
  afterEach(() => h.close())

  const present = (token: string) => principalFrom(bearerRequest(token), h.ctx, authStub(null))
  const adminKeys = async (principal: IdpPrincipal = root.principal) =>
    (await kitContext(h.ctx, principal, null)).services.admin_keys
  const list = async () => (await (await adminKeys()).list()).keys

  /** Everything the bootstrap key isn't — the listing always contains it too. */
  const minted = <K extends { name: string }>(keys: K[]) => keys.filter((k) => k.name !== root.name)

  describe("minting and presenting", () => {
    it("mints a key the resolver accepts as a named superadmin", async () => {
      const created = await (await adminKeys()).mint({ name: "Agent alpha" })
      expect(created.token.startsWith("wim_")).toBe(true)
      expect(created.prefix).toBe(created.token.slice(0, 12))

      const principal = (await present(created.token))!
      expect(principal).toEqual({ id: `adminkey:${created.id}`, grants: ["*"], memberships: [] })
      const caller = appRbac.callerFor(principal, "literally-anything")
      expect(caller.isSuperadmin).toBe(true)
      expect(caller.granted).toEqual([...APP_PERMISSIONS])
    })

    it("lets an admin key mint another admin key", async () => {
      const first = await mintAdminKey(h.ctx, { name: "Agent alpha" }, root.principal)
      const second = await (await adminKeys((await present(first.token))!)).mint({ name: "Agent beta" })
      expect((await present(second.token))?.id).toBe(`adminkey:${second.id}`)
    })

    it("lists admin keys without ever exposing a hash", async () => {
      await mintAdminKey(h.ctx, { name: "Agent alpha" }, root.principal)
      const keys = await list()
      expect(minted(keys)).toMatchObject([{ name: "Agent alpha", status: "active" }])
      expect(JSON.stringify(keys)).not.toContain("keyHash")
    })

    it("keeps admin keys out of an app's key list", async () => {
      await mintAdminKey(h.ctx, {}, root.principal)
      await mintApiKey(h.ctx, { app: "acme", name: "Scoped" }, root.principal)
      const { keys } = await (await kitContext(h.ctx, root.principal, "acme")).services.management_keys.list()
      expect(keys.map((k) => k.name)).toEqual(["Scoped"])
    })
  })

  describe("revocation and expiry", () => {
    it("stops authenticating once revoked", async () => {
      const { token, id } = await mintAdminKey(h.ctx, {}, root.principal)
      expect(await present(token)).not.toBeNull()

      expect(await (await adminKeys()).revoke({ id })).toEqual({ ok: true })
      expect(await present(token)).toBeNull()
    })

    it("is idempotent on a second revoke", async () => {
      const { id } = await mintAdminKey(h.ctx, {}, root.principal)
      await (await adminKeys()).revoke({ id })
      expect(await (await adminKeys()).revoke({ id })).toEqual({ ok: true })
    })

    it("404s an unknown id", async () => {
      expect(await failureOf((await adminKeys()).revoke({ id: "nope" }))).toEqual({
        status: 404,
        error: "Key not found.",
      })
    })

    it("lets a key revoke itself, loudly", async () => {
      const { token, id } = await mintAdminKey(h.ctx, {}, root.principal)
      const self = (await present(token))!

      expect(await (await adminKeys(self)).revoke({ id })).toEqual({ ok: true })
      expect(h.logs.filter((l) => l.message === "adminkey.self_revoke")).toHaveLength(1)
      // An agent that cleans up after itself has genuinely locked itself out.
      expect(await present(token)).toBeNull()
    })

    it("stops authenticating once expired", async () => {
      const { token } = await mintAdminKey(
        h.ctx,
        { expiresAt: new Date(Date.now() - 1000) },
        root.principal,
      )
      expect(await present(token)).toBeNull()
    })

    it("reports expiry in the listing", async () => {
      await mintAdminKey(h.ctx, { expiresAt: new Date(Date.now() - 1000) }, root.principal)
      expect(minted(await list())[0].status).toBe("expired")
    })
  })

  describe("who may manage them", () => {
    const refusedAll = async (principal: IdpPrincipal) => {
      const { id } = await mintAdminKey(h.ctx, {}, root.principal)
      const keys = await adminKeys(principal)
      for (const call of [() => keys.list(), () => keys.mint({ name: "Nope" }), () => keys.revoke({ id })])
        expect((await failureOf(call())).status).toBe(403)
    }

    it("refuses a signed-in human, however privileged on an app", async () => {
      await refusedAll(memberPrincipal("u1", "acme", [...APP_PERMISSIONS]))
    })

    it("refuses an app-scoped key holding every app permission", async () => {
      const scoped = await mintApiKey(
        h.ctx,
        { app: "acme", permissions: [...APP_PERMISSIONS] },
        root.principal,
      )
      const principal = (await present(scoped.token))!
      expect(principal.id).toBe(`apikey:${scoped.id}`)
      await refusedAll(principal)
    })

    it("does not let an app-scoped revoke reach an admin key by id", async () => {
      const admin = await mintAdminKey(h.ctx, {}, root.principal)
      const keys = (await kitContext(h.ctx, root.principal, "acme")).services.management_keys
      expect((await failureOf(keys.revoke({ id: admin.id }))).status).toBe(404)
      // Still very much alive.
      expect(await present(admin.token)).not.toBeNull()
    })
  })

  describe("audit trail", () => {
    it("records the mint under the IdP scope", async () => {
      const created = await (await adminKeys()).mint({ name: "Agent" })
      const entries = await listAuditForApp(h.ctx, IDP_AUDIT_SCOPE)
      expect(entries).toMatchObject([
        {
          tableName: "api_key",
          operation: "create",
          rowId: created.id,
          actor: `adminkey:${root.id}`,
        },
      ])
    })

    it("names the admin key that acted, not just 'a superadmin'", async () => {
      const first = await mintAdminKey(h.ctx, { name: "Agent alpha" }, root.principal)
      const asFirst = await adminKeys((await present(first.token))!)
      const second = await asFirst.mint({ name: "Agent beta" })
      await asFirst.revoke({ id: second.id })

      const entries = await listAuditForApp(h.ctx, IDP_AUDIT_SCOPE)
      expect(entries.filter((e) => e.actor === `adminkey:${first.id}`)).toMatchObject([
        { operation: "revoke", rowId: second.id },
        { operation: "create", rowId: second.id },
      ])
    })

    it("keeps IdP-level rows out of an app's audit view", async () => {
      await mintAdminKey(h.ctx, {}, root.principal)
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
        const res = (await handler({ context: routerContext(context), ...args } as never)) as Response
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
      const scoped = await mintApiKey(
        h.ctx,
        { app: "acme", permissions: [...APP_PERMISSIONS] },
        root.principal,
      )
      const res = await call(adminKeyRoute.loader, {
        request: request("/api/v1/admin-keys", { token: scoped.token }),
      })
      expect(res).toMatchObject({ status: 403, body: { error: "forbidden" } })
    })

    it("201s with the plaintext token exactly once", async () => {
      const res = await call(adminKeyRoute.action, {
        request: request("/api/v1/admin-keys", {
          method: "POST",
          token: root.token,
          body: { name: "Agent alpha" },
        }),
      })
      expect(res.status).toBe(201)
      const body = res.body as { id: string; token: string; prefix: string }
      expect(body.token.startsWith("wim_")).toBe(true)

      // The token works, and the listing never shows it again.
      expect((await present(body.token))!.id).toBe(`adminkey:${body.id}`)
      const list = await call(adminKeyRoute.loader, {
        request: request("/api/v1/admin-keys", { token: root.token }),
      })
      expect(list.status).toBe(200)
      expect(JSON.stringify(list.body)).not.toContain(body.token)
      const keys = (list.body as { keys: { id: string; name: string }[] }).keys
      expect(minted(keys)).toMatchObject([{ id: body.id, name: "Agent alpha" }])
    })

    it("400s a body with no name, naming the field", async () => {
      const res = await call(adminKeyRoute.action, {
        request: request("/api/v1/admin-keys", {
          method: "POST",
          token: root.token,
          body: { name: "" },
        }),
      })
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ fields: { name: [expect.any(String)] } })
    })

    it("200s a delete and 404s an unknown id", async () => {
      const { id } = await mintAdminKey(h.ctx, {}, root.principal)
      const ok = await call(adminKeyIdRoute.action, {
        request: request(`/api/v1/admin-keys/${id}`, { method: "DELETE", token: root.token }),
        params: { id },
      })
      expect(ok).toMatchObject({ status: 200, body: { ok: true } })

      const missing = await call(adminKeyIdRoute.action, {
        request: request("/api/v1/admin-keys/nope", { method: "DELETE", token: root.token }),
        params: { id: "nope" },
      })
      expect(missing).toMatchObject({ status: 404, body: { error: "Key not found." } })
    })

    it("405s an unsupported method, saying what it does allow", async () => {
      const collection = await call(adminKeyRoute.action, {
        request: request("/api/v1/admin-keys", { method: "PATCH", token: root.token }),
      })
      expect(collection.status).toBe(405)
      expect(collection.headers.get("Allow")).toBe("GET, POST")

      const item = await call(adminKeyIdRoute.action, {
        request: request("/api/v1/admin-keys/x", { method: "POST", token: root.token }),
        params: { id: "x" },
      })
      expect(item.status).toBe(405)
      expect(item.headers.get("Allow")).toBe("DELETE")
    })
  })
})
