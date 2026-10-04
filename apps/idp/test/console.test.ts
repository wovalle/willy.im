import { afterEach, beforeEach, describe, expect, it } from "vitest"

import * as appDetail from "../app/routes/app/app-detail"
import * as users from "../app/routes/app/users"
import type { AuthService } from "../app/lib/auth.server"
import {
  createApplication,
  createMember,
  createUser,
  noResources,
} from "./helpers/fixtures"
import { createTestHarness, routerContext, type TestHarness } from "./helpers/harness"

/**
 * The console: loaders and actions go through `consoleContext` and call the
 * same methods the API serves; a form intent is one row of a table.
 */
describe("console", () => {
  let h: TestHarness
  let acme: { clientId: string }
  let session: { id: string; email: string } | null

  beforeEach(async () => {
    h = createTestHarness({ env: { ADMIN_EMAILS: "super@willy.im" } })
    acme = await createApplication(h.ctx, { app: "acme", permissions: ["invoices:read"] })
    session = null
  })
  afterEach(() => h.close())

  const context = () => {
    const auth = {
      api: {
        getSession: async () => (session ? { user: session, session: { impersonatedBy: null } } : null),
      },
    } as unknown as AuthService
    return routerContext({ ...h.ctx, services: { auth, resources: noResources }, cloudflare: {} })
  }

  /** Runs a route handler, returning a thrown Response (redirects) as its answer. */
  const run = async (handler: (args: never) => unknown, args: Record<string, unknown>) => {
    try {
      return await handler({ context: context(), ...args } as never)
    } catch (e) {
      if (e instanceof Response) return e
      throw e
    }
  }

  const post = (fields: Record<string, string | string[]>) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) form.append(k, x)
    return run(appDetail.action, {
      request: new Request(`https://idp.willy.im/apps/${acme.clientId}`, { method: "POST", body: form }),
      params: { clientId: acme.clientId },
    })
  }
  const page = () =>
    run(appDetail.loader, {
      request: new Request(`https://idp.willy.im/apps/${acme.clientId}`),
      params: { clientId: acme.clientId },
    }) as Promise<Awaited<ReturnType<typeof appDetail.loader>> | Response>

  const signIn = async (email: string, membership?: { role: "admin" | "member"; permissions?: string[] }) => {
    const user = await createUser(h.ctx, { email })
    if (membership) await createMember(h.ctx, { app: "acme", userId: user.id, ...membership })
    session = user
    return user
  }

  it("sends nobody to /login and a non-admin away from superadmin pages to /account", async () => {
    const anonymous = (await run(users.loader, { request: new Request("https://idp.willy.im/users") })) as Response
    expect(anonymous.headers.get("location")).toBe("/login")
    await signIn("member@acme.test", { role: "member", permissions: ["app:read"] })
    const member = (await run(users.loader, { request: new Request("https://idp.willy.im/users") })) as Response
    expect(member.headers.get("location")).toBe("/account")
  })

  it("opens an app to a member with app:read, reading only the lists they may read", async () => {
    await signIn("member@acme.test", { role: "member", permissions: ["app:read", "member:read"] })
    const data = await page()
    if (data instanceof Response) throw new Error(`redirected to ${data.headers.get("location")}`)
    expect(data.application).toMatchObject({ app: "acme" })
    expect(data.permissions).toEqual(["app:read", "member:read"])
    expect(data.members).toHaveLength(1)
    expect(data.apiKeys).toEqual([])
    expect(data.isSuperadmin).toBe(false)
  })

  it("bounces someone who holds nothing in the app to /account", async () => {
    await signIn("stranger@x.test")
    expect(((await page()) as Response).headers.get("location")).toBe("/account")
  })

  it("runs an intent through its method, and shows a refusal on the form", async () => {
    await signIn("boss@acme.test", { role: "admin" })
    expect(await post({ intent: "create-workspace", name: "Romo", slug: "romo" })).toEqual({ ok: "workspace" })
    expect(await post({ intent: "create-workspace", name: "Again", slug: "romo" })).toEqual({
      error: 'Slug "romo" is already taken.',
      field: "ws-name",
    })
    expect(await post({ intent: "invite-member", email: "not-an-email" })).toMatchObject({
      error: expect.stringContaining("email"),
      field: "invite-email",
    })
    expect(await post({ intent: "add-permission", permission: "invoices:write" })).toEqual({
      ok: "permission-added",
    })
    expect(await post({ intent: "nope" })).toEqual({ error: "Unknown action" })
  })

  it("shows a member the method's refusal when they lack its permission", async () => {
    await signIn("reader@acme.test", { role: "member", permissions: ["app:read", "apikey:create", "member:read"] })
    expect(await post({ intent: "create-api-key", name: "CI", permissions: ["member:manage"] })).toEqual({
      error: "You can't grant permissions you don't hold: member:manage.",
      field: "key-name",
    })
    expect(await post({ intent: "rotate" })).toBeInstanceOf(Response)
  })
})
