import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  PERMISSIONS_CLAIM,
  WORKSPACES_CLAIM,
  customClaimsFor,
  pictureClaimFor,
} from "../app/lib/claims.server"
import {
  addWorkspaceMember,
  createApplication,
  createMember,
  createSession,
  createUser,
  createWorkspace,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * The claim set an OAuth client sees. Everything here is app-scoped: the whole
 * point is that a token minted for app A never carries app B's tenants.
 */
describe("customClaimsFor", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  const CATALOG = ["invoices:read", "invoices:write"]
  const metaFor = (app: string, permissions = CATALOG) => ({
    app,
    allow_signup: false,
    permissions,
  })

  type WorkspaceClaim = { id: string; slug: string; role: string }

  it("emits only the workspaces belonging to the requesting app", async () => {
    const user = await createUser(h.ctx, { email: "multi@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createApplication(h.ctx, { app: "other", permissions: CATALOG })

    const acmeWs = await createWorkspace(h.ctx, { app: "acme", slug: "acme-hq" })
    const otherWs = await createWorkspace(h.ctx, { app: "other", slug: "other-hq" })
    await addWorkspaceMember(h.ctx, { organizationId: acmeWs.id, userId: user.id, role: "owner" })
    await addWorkspaceMember(h.ctx, { organizationId: otherWs.id, userId: user.id, role: "owner" })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    const workspaces = claims[WORKSPACES_CLAIM] as WorkspaceClaim[]

    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].slug).toBe("acme-hq")
    expect(workspaces.map((w) => w.slug)).not.toContain("other-hq")
  })

  it("carries the user's role within each workspace", async () => {
    const user = await createUser(h.ctx, { email: "owner@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    const ws = await createWorkspace(h.ctx, { app: "acme", slug: "acme-hq" })
    await addWorkspaceMember(h.ctx, { organizationId: ws.id, userId: user.id, role: "owner" })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    expect((claims[WORKSPACES_CLAIM] as WorkspaceClaim[])[0].role).toBe("owner")
  })

  it("omits the workspaces claim entirely when there are none", async () => {
    const user = await createUser(h.ctx, { email: "lonely@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    expect(claims).not.toHaveProperty(WORKSPACES_CLAIM)
  })

  it("emits the app's product permissions for a member", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      productPermissions: ["invoices:read"],
    })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    expect(claims[PERMISSIONS_CLAIM]).toEqual(["invoices:read"])
  })

  it("does not leak another app's membership into the permissions claim", async () => {
    const user = await createUser(h.ctx, { email: "cross@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createApplication(h.ctx, { app: "other", permissions: CATALOG })
    await createMember(h.ctx, { app: "other", userId: user.id, role: "admin" })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    expect(claims).not.toHaveProperty(PERMISSIONS_CLAIM)
  })

  it("omits the act claim when nobody is impersonating", async () => {
    const user = await createUser(h.ctx, { email: "solo@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createSession(h.ctx, { userId: user.id })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    expect(claims).not.toHaveProperty("act")
  })

  it("emits the act claim during a live impersonation", async () => {
    const admin = await createUser(h.ctx, { email: "super@willy.im" })
    const user = await createUser(h.ctx, { email: "target@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createSession(h.ctx, { userId: user.id, impersonatedBy: admin.id })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    expect(claims.act).toEqual({ sub: admin.id, email: "super@willy.im" })
  })

  it("ignores an expired impersonation session", async () => {
    const admin = await createUser(h.ctx, { email: "super@willy.im" })
    const user = await createUser(h.ctx, { email: "target@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createSession(h.ctx, {
      userId: user.id,
      impersonatedBy: admin.id,
      expiresAt: new Date(Date.now() - 1000),
    })

    const claims = await customClaimsFor(h.ctx.db, user.id, metaFor("acme"))
    expect(claims).not.toHaveProperty("act")
  })

  it("emits nothing at all for a client with no app tag", async () => {
    const user = await createUser(h.ctx, { email: "untagged@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "admin" })

    const claims = await customClaimsFor(h.ctx.db, user.id, { allow_signup: true })
    expect(claims).toEqual({})
  })
})

/**
 * The `picture` claim, which is a guarantee rather than a passthrough: consumer
 * apps are entitled to assume every user has a face.
 */
describe("pictureClaimFor", () => {
  it("falls back to this issuer's blobatar, seeded on the user id", () => {
    expect(pictureClaimFor({ id: "usr_123", image: null }, "https://idp.willy.im")).toEqual({
      picture: "https://idp.willy.im/avatar/usr_123",
    })
  })

  it("leaves an uploaded picture alone", () => {
    expect(
      pictureClaimFor({ id: "usr_123", image: "https://cdn.test/me.png" }, "https://idp.willy.im"),
    ).toEqual({ picture: "https://cdn.test/me.png" })
  })

  it("uses the requested host, so a vanity domain's tokens stay first-party", () => {
    expect(pictureClaimFor({ id: "usr_123" }, "https://idp.kasso.do")).toEqual({
      picture: "https://idp.kasso.do/avatar/usr_123",
    })
  })
})
