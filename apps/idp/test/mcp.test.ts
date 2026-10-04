import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { AppContext } from "../app/context"
import { serveMcp } from "../app/kit.server"
import type { AuthService } from "../app/lib/auth.server"
import { bootstrapAdminKey, createApplication, mintApiKey, noResources } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * MCP at /mcp (IdP-level tools) and /mcp/<app> (one app's), through a real MCP
 * client over Streamable HTTP, answered by the Worker's handler.
 */
describe("MCP", () => {
  let h: TestHarness
  let c: AppContext
  let admin: Awaited<ReturnType<typeof bootstrapAdminKey>>

  beforeEach(async () => {
    h = createTestHarness()
    const auth = { api: { getSession: async () => null } } as unknown as AuthService
    c = { ...h.ctx, services: { auth, resources: noResources } } as unknown as AppContext
    admin = await bootstrapAdminKey(h.ctx)
    await createApplication(h.ctx, { app: "acme" })
  })
  afterEach(() => h.close())

  /** A connected MCP client on `path`, as `token`. */
  const connect = async (path: string, token: string) => {
    const client = new Client({ name: "test", version: "1" })
    const transport = new StreamableHTTPClientTransport(new URL(`https://idp.willy.im${path}`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) =>
        (await serveMcp(c, new Request(input as RequestInfo, init))) ?? new Response(null, { status: 404 }),
    })
    await client.connect(transport)
    return client
  }
  const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name).sort()

  it("lists IdP-level tools at /mcp and one app's at /mcp/<app>, to an admin key", async () => {
    const idp = await names(await connect("/mcp", admin.token))
    expect(idp).toContain("applications_register")
    expect(idp).toContain("admin_keys_mint")
    expect(idp).not.toContain("members_invite")

    const acme = await names(await connect("/mcp/acme", admin.token))
    expect(acme).toContain("members_invite")
    expect(acme).toContain("user_keys_validate")
    expect(acme).not.toContain("applications_register")
    // No browser session behind a key: impersonation isn't a tool.
    expect(acme).not.toContain("users_impersonate")
  })

  it("gives an app-scoped key only what it holds, and calls the method", async () => {
    const key = await mintApiKey(h.ctx, { app: "acme", permissions: ["workspace:read", "workspace:create"] }, admin.principal)
    const client = await connect("/mcp/acme", key.token)
    expect(await names(client)).toEqual([
      "workspace_members_list",
      "workspaces_create",
      "workspaces_list",
      "workspaces_people",
    ])

    const created = await client.callTool({ name: "workspaces_create", arguments: { name: "Romo", slug: "romo" } })
    expect(created.structuredContent).toMatchObject({ name: "Romo", slug: "romo" })
    const refused = await client.callTool({ name: "workspaces_create", arguments: { name: "R", slug: "romo" } })
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.content)).toContain('Slug \\"romo\\" is already taken.')
  })

  it("401s no key, and 404s an app the key holds nothing in", async () => {
    const anon = await serveMcp(c, new Request("https://idp.willy.im/mcp", { method: "POST", body: "{}" }))
    expect(anon?.status).toBe(401)
    expect(anon?.headers.get("www-authenticate")).toBe("Bearer")

    const key = await mintApiKey(h.ctx, { app: "acme", permissions: ["member:read"] }, admin.principal)
    const other = await serveMcp(
      c,
      new Request("https://idp.willy.im/mcp/other", {
        method: "POST",
        headers: { authorization: `Bearer ${key.token}` },
        body: "{}",
      }),
    )
    expect(other?.status).toBe(404)
    expect(await serveMcp(c, new Request("https://idp.willy.im/mcpx"))).toBeNull()
  })
})
