import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import * as consent from "../app/routes/consent"
import * as inviteAccept from "../app/routes/invite.accept"
import * as schema from "../app/db/schema"
import type { AuthService } from "../app/lib/auth.server"
import { clientDisplayName } from "../app/lib/client-display"
import { createApplication } from "./helpers/fixtures"
import { createTestHarness, routerContext, type TestHarness } from "./helpers/harness"

/**
 * The consent screen names the client by what it registered, never by its
 * client_id — the loader looks the client up, and the page renders that.
 */
describe("consent screen", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  /** An OAuth client with a GUID client_id, the shape production mints. */
  const seedClient = async (fields: { name?: string | null; icon?: string; redirectUris: string[] }) => {
    const clientId = crypto.randomUUID()
    await h.ctx.db.insert(schema.oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      name: fields.name ?? null,
      icon: fields.icon ?? null,
      redirectUris: fields.redirectUris,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    return clientId
  }

  /** Runs the loader on a consent URL as the plugin builds it, and renders the page with its data. */
  const render = async (query: Record<string, string>) => {
    const url = `https://idp.willy.im/consent?${new URLSearchParams({ scope: "openid profile email", ...query })}`
    const loaderData = await consent.loader({
      request: new Request(url),
      context: routerContext(h.ctx),
    } as never)
    const html = renderToStaticMarkup(
      createElement(consent.default, { loaderData } as unknown as Parameters<typeof consent.default>[0]),
    )
    return { loaderData, html }
  }

  it("shows the registered name and not the client_id", async () => {
    const clientId = await seedClient({
      name: "Acme Invoices",
      redirectUris: ["https://invoices.acme.test/auth/callback"],
    })
    const { loaderData, html } = await render({
      client_id: clientId,
      redirect_uri: "https://invoices.acme.test/auth/callback",
    })

    expect(loaderData.client).toEqual({ name: "Acme Invoices", host: "invoices.acme.test", icon: null })
    expect(html).toContain("Acme Invoices")
    expect(html).toContain("invoices.acme.test")
    expect(html).toContain("Your email address")
    expect(html).not.toContain(clientId)
  })

  it("names a nameless client (dynamic registration, e.g. claude.ai) by its host", async () => {
    const clientId = await seedClient({ redirectUris: ["https://claude.ai/api/mcp/auth_callback"] })
    const { loaderData, html } = await render({ client_id: clientId })

    expect(loaderData.client.name).toBe("claude.ai")
    expect(loaderData.client.host).toBeNull()
    expect(html).toContain("claude.ai")
    expect(html).not.toContain(clientId)
  })

  it("never echoes an unknown client_id back", async () => {
    const { loaderData, html } = await render({ client_id: "11111111-2222-3333-4444-555555555555" })
    expect(loaderData.client).toEqual({ name: "An application", host: null, icon: null })
    expect(html).not.toContain("11111111-2222-3333-4444-555555555555")
  })

  it("shows an https icon, and drops any other", async () => {
    const https = await seedClient({
      name: "Acme",
      icon: "https://acme.test/logo.png",
      redirectUris: ["https://acme.test/cb"],
    })
    expect((await render({ client_id: https })).html).toContain('src="https://acme.test/logo.png"')

    const insecure = await seedClient({
      name: "Acme",
      icon: "http://acme.test/logo.png",
      redirectUris: ["https://acme.test/cb"],
    })
    expect((await render({ client_id: insecure })).loaderData.client.icon).toBeNull()
  })

  it("names the host from the registration, not an unregistered redirect_uri on the query", async () => {
    const clientId = await seedClient({ name: "Acme", redirectUris: ["https://acme.test/cb"] })
    const { loaderData } = await render({ client_id: clientId, redirect_uri: "https://evil.test/cb" })
    expect(loaderData.client.host).toBe("acme.test")
  })
})

describe("clientDisplayName (console list, app header, invite page)", () => {
  it("is the trimmed name, else the client's host, else a generic label — never the client_id", () => {
    expect(clientDisplayName({ name: "  Acme  ", redirectUris: ["https://acme.test/cb"] })).toBe("Acme")
    expect(clientDisplayName({ name: " ", uri: "https://www.acme.test", redirectUris: ["https://cb.acme.test/x"] })).toBe(
      "www.acme.test",
    )
    expect(clientDisplayName({ name: null, redirectUris: ["https://claude.ai/api/mcp/auth_callback"] })).toBe("claude.ai")
    expect(clientDisplayName({ name: null, redirectUris: ["myapp://callback"] })).toBe("An application")
  })
})

describe("invite page", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  it("names the app by its registered name, not its key", async () => {
    await createApplication(h.ctx, { app: "acme", name: "Acme Invoices" })
    await h.ctx.db.insert(schema.applicationInvitation).values({
      applicationId: "acme",
      email: "friend@example.com",
      token: "tok",
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const auth = { api: { getSession: async () => null } } as unknown as AuthService
    const data = await inviteAccept.loader({
      request: new Request("https://idp.willy.im/invite/accept?token=tok"),
      context: routerContext({ ...h.ctx, services: { auth } }),
    } as never)
    expect(data).toMatchObject({ state: "ready", app: "Acme Invoices" })
  })
})
