import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { AppContext } from "../app/context"
import { serveApi } from "../app/kit.server"
import type { AuthService } from "../app/lib/auth.server"
import {
  bootstrapAdminKey,
  createApplication,
  createMember,
  createUser,
  mintApiKey,
  noResources,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * kit's generated HTTP API, as the Worker serves it: `/apps/<app>/api/...` in
 * an app, `/api/...` at the IdP level, bearer keys only.
 */
describe("the generated HTTP API", () => {
  let h: TestHarness
  let c: AppContext
  let admin: string
  let user: { id: string; email: string }

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    user = await createUser(h.ctx, { email: "super@willy.im" })
    // A signed-in superadmin's session: it must never reach this API.
    const auth = {
      api: { getSession: async () => ({ user, session: { impersonatedBy: null } }) },
    } as unknown as AuthService
    c = { ...h.ctx, services: { auth, resources: noResources } } as unknown as AppContext
    admin = (await bootstrapAdminKey(h.ctx)).token
    await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
    await createApplication(h.ctx, { app: "other" })
  })
  afterEach(() => h.close())

  const call = async (path: string, init: { token?: string; body?: unknown; method?: string } = {}) => {
    const res = await serveApi(
      c,
      new Request(`https://idp.willy.im${path}`, {
        method: init.method ?? (path.includes("/api/") ? "POST" : "GET"),
        headers: {
          cookie: "better-auth.session_token=signed-in",
          ...(init.token && { authorization: `Bearer ${init.token}` }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      }),
    )
    if (!res) return null
    const text = await res.text()
    let body: any = text
    try {
      body = JSON.parse(text)
    } catch {}
    return { status: res.status, body }
  }

  it("validates an end-user key at /apps/<app>/api/user_keys.validate with the app's own key", async () => {
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "member", productPermissions: ["invoices:read"] })
    const appKey = await mintApiKey(h.ctx, { app: "acme", permissions: ["userkey:create", "userkey:validate"] }, (await bootstrapAdminKey(h.ctx)).principal)
    const minted = await call("/apps/acme/api/user_keys.mint", {
      token: appKey.token,
      body: { userId: user.id, name: "CLI", scopes: ["invoices:read"] },
    })
    expect(minted?.status).toBe(200)
    const token = minted!.body.token as string

    expect(await call("/apps/acme/api/user_keys.validate", { token: appKey.token, body: { token } })).toEqual({
      status: 200,
      body: expect.objectContaining({ valid: true, kind: "user", userId: user.id, scopes: ["invoices:read"] }),
    })
    // The key is for acme: another app is a 404, and the IdP level holds nothing for it.
    expect((await call("/apps/other/api/user_keys.validate", { token: appKey.token, body: { token } }))?.status).toBe(404)
    expect((await call("/api/applications.list", { token: appKey.token }))?.status).toBe(403)
  })

  it("serves IdP-level methods at /api/ to an admin key, stripped to the contract", async () => {
    const res = await call("/api/applications.list", { token: admin })
    expect(res?.status).toBe(200)
    expect(res!.body.applications.map((a: { app: string }) => a.app).sort()).toEqual(["acme", "other"])
    // An app's methods don't exist at the IdP level, and the reverse.
    expect((await call("/api/members.list", { token: admin }))?.status).toBe(404)
    expect((await call("/apps/acme/api/applications.list", { token: admin }))?.status).toBe(404)
  })

  it("answers kit's errors: 400 with the fields, fail()'s status and message", async () => {
    expect(await call("/apps/acme/api/workspaces.create", { token: admin, body: { name: "" } })).toMatchObject({
      status: 400,
      body: { error: "invalid input", fields: { name: expect.any(Array), slug: expect.any(Array) } },
    })
    expect(await call("/apps/acme/api/members.remove", { token: admin, body: { userId: "ghost" } })).toEqual({
      status: 404,
      body: { error: "Member not found." },
    })
  })

  it("ignores the session cookie: no bearer is anonymous, and anonymous is a 401", async () => {
    const res = await call("/api/applications.list")
    expect(res?.status).toBe(401)
    expect((await call("/apps/acme/api/members.list"))?.status).toBe(401)
  })

  it("lists only what the caller may call, with the app in the documents' URLs", async () => {
    const reader = await mintApiKey(h.ctx, { app: "acme", permissions: ["member:read"] }, (await bootstrapAdminKey(h.ctx)).principal)
    const doc = await call("/apps/acme/openapi.json", { token: reader.token })
    expect(doc?.body.servers).toEqual([{ url: "https://idp.willy.im/apps/acme" }])
    expect(Object.keys(doc!.body.paths).sort()).toEqual(["/api/invitations.list", "/api/members.list"])

    const llms = await serveApi(
      c,
      new Request("https://idp.willy.im/llms.txt", { headers: { authorization: `Bearer ${admin}` } }),
    )
    expect(await llms!.text()).toContain("### applications.register")
  })

  it("leaves every other path to React Router", async () => {
    for (const path of ["/apps/client_123", "/apps/acme/resources", "/"])
      expect(await call(path, { token: admin })).toBeNull()
  })
})
