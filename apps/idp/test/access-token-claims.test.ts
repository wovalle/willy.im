import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getApplication, updateApplication } from "../app/lib/admin.server"
import type { Caller } from "../app/lib/caller.server"
import {
  APP_CLAIM,
  PERMISSIONS_CLAIM,
  accessTokenClaimsFor,
  allResources,
  appForResource,
} from "../app/lib/claims.server"
import { bootstrapAdminKey, createApplication, createMember, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Access tokens for resource servers. The claim on the token is the user's
 * grants for the app that OWNS the requested resource — not for the OAuth
 * client that asked — which is what lets one dynamically-registered client
 * (Claude) receive different grants for different apps' MCP servers.
 */
describe("access-token claims by resource", () => {
  let h: TestHarness
  let root: Caller
  let bender: { clientId: string }
  let willy: { id: string }
  let gf: { id: string }

  const BENDER_MCP = "https://bender.romo.fyi/mcp"
  const CATALOG = ["chat:respond", "kirby:chats:read", "tool:publish_artifact"]

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).caller
    bender = await createApplication(h.ctx, { app: "bender", permissions: CATALOG })
    await createApplication(h.ctx, { app: "other", permissions: ["x:read"] })
    willy = await createUser(h.ctx, { email: "hey@willy.im" })
    gf = await createUser(h.ctx, { email: "gf@example.com" })
    await createMember(h.ctx, { app: "bender", userId: willy.id, role: "admin" })
    await createMember(h.ctx, {
      app: "bender",
      userId: gf.id,
      role: "member",
      productPermissions: ["chat:respond", "tool:publish_artifact"],
    })
    await updateApplication(h.ctx, root, bender.clientId, { resources: [BENDER_MCP] })
  })
  afterEach(() => h.close())

  describe("resources on an application", () => {
    it("round-trip through the PATCH service and survive other metadata edits", async () => {
      expect((await getApplication(h.ctx, bender.clientId))!.resources).toEqual([BENDER_MCP])
      await updateApplication(h.ctx, root, bender.clientId, { allowSignup: true })
      expect((await getApplication(h.ctx, bender.clientId))!.resources).toEqual([BENDER_MCP])
    })

    it("must be absolute https with no fragment — an audience is matched exactly", async () => {
      for (const bad of ["http://bender.romo.fyi/mcp", "bender.romo.fyi/mcp", "https://bender.romo.fyi/mcp#x"]) {
        const res = await updateApplication(h.ctx, root, bender.clientId, { resources: [bad] })
        expect(res).toEqual({ error: "invalid_resource", detail: bad })
      }
    })

    it("are the token endpoint's valid audiences", async () => {
      expect(await allResources(h.ctx.db)).toEqual([BENDER_MCP])
      expect(await appForResource(h.ctx.db, BENDER_MCP)).toEqual({ app: "bender", catalog: CATALOG })
      expect(await appForResource(h.ctx.db, "https://nobody.example/mcp")).toBeNull()
    })
  })

  describe("the claims", () => {
    // A dynamically-registered client carries no `app` — exactly Claude's case.
    const anonymousClient = {}

    it("an admin asking for bender's resource gets bender's whole catalog", async () => {
      const claims = await accessTokenClaimsFor(h.ctx.db, willy.id, BENDER_MCP, anonymousClient)
      expect(claims[APP_CLAIM]).toBe("bender")
      expect(claims[PERMISSIONS_CLAIM]).toEqual(CATALOG)
    })

    it("a member gets exactly their grants for that app", async () => {
      const claims = await accessTokenClaimsFor(h.ctx.db, gf.id, BENDER_MCP, anonymousClient)
      expect(claims[PERMISSIONS_CLAIM]).toEqual(["chat:respond", "tool:publish_artifact"])
    })

    it("a user with no membership in the owning app gets no permissions claim at all", async () => {
      const stranger = await createUser(h.ctx, { email: "s@example.com" })
      const claims = await accessTokenClaimsFor(h.ctx.db, stranger.id, BENDER_MCP, anonymousClient)
      expect(claims[APP_CLAIM]).toBe("bender")
      expect(claims[PERMISSIONS_CLAIM]).toBeUndefined()
    })

    it("the resource wins over the client's own app — one client, many resource servers", async () => {
      // A first-party client tagged `other` asking for bender's resource is
      // judged against bender, not against `other`.
      const otherClient = { app: "other", permissions: ["x:read"] }
      const claims = await accessTokenClaimsFor(h.ctx.db, willy.id, BENDER_MCP, otherClient)
      expect(claims[APP_CLAIM]).toBe("bender")
    })

    it("no resource falls back to the client's app — the pre-MCP behaviour", async () => {
      const benderClient = { app: "bender", permissions: CATALOG }
      const claims = await accessTokenClaimsFor(h.ctx.db, gf.id, undefined, benderClient)
      expect(claims[APP_CLAIM]).toBe("bender")
      expect(claims[PERMISSIONS_CLAIM]).toEqual(["chat:respond", "tool:publish_artifact"])
    })

    it("an array of resources uses the first", async () => {
      const claims = await accessTokenClaimsFor(h.ctx.db, willy.id, [BENDER_MCP], anonymousClient)
      expect(claims[APP_CLAIM]).toBe("bender")
    })
  })
})
