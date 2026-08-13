import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { APP_PERMISSIONS, resolvePermissions } from "../app/lib/permissions"
import { productPermissionsFor } from "../app/lib/claims.server"
import { createApplication, createMember, createUser } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

describe("resolvePermissions", () => {
  it("gives an admin the whole management catalog", () => {
    expect(resolvePermissions("admin")).toEqual([...APP_PERMISSIONS])
  })

  it("ignores explicit grants for an admin (they already have everything)", () => {
    expect(resolvePermissions("admin", ["app:read"])).toEqual([...APP_PERMISSIONS])
  })

  it("gives a member exactly their grants", () => {
    expect(resolvePermissions("member", ["app:read", "member:read"])).toEqual([
      "app:read",
      "member:read",
    ])
  })

  it("drops grants that are not in the catalog", () => {
    expect(resolvePermissions("member", ["app:read", "totally:made-up"])).toEqual(["app:read"])
  })

  it("gives a member with no grants nothing", () => {
    expect(resolvePermissions("member")).toEqual([])
  })
})

describe("productPermissionsFor", () => {
  let h: TestHarness
  beforeEach(() => {
    h = createTestHarness()
  })
  afterEach(() => h.close())

  const CATALOG = ["invoices:read", "invoices:write", "reports:read"]

  it("resolves an admin to the app's full declared catalog", async () => {
    const user = await createUser(h.ctx, { email: "admin@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "admin" })

    expect(await productPermissionsFor(h.ctx.db, user.id, "acme", CATALOG)).toEqual(CATALOG)
  })

  it("resolves a member to their grants intersected with the catalog", async () => {
    const user = await createUser(h.ctx, { email: "member@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      productPermissions: ["invoices:read", "reports:read"],
    })

    expect(await productPermissionsFor(h.ctx.db, user.id, "acme", CATALOG)).toEqual([
      "invoices:read",
      "reports:read",
    ])
  })

  it("drops stale grants when the catalog shrinks", async () => {
    const user = await createUser(h.ctx, { email: "stale@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createMember(h.ctx, {
      app: "acme",
      userId: user.id,
      role: "member",
      productPermissions: ["invoices:read", "reports:read"],
    })

    // The app removed reports:read from its catalog after the grant was made.
    const shrunk = ["invoices:read", "invoices:write"]
    expect(await productPermissionsFor(h.ctx.db, user.id, "acme", shrunk)).toEqual([
      "invoices:read",
    ])
  })

  it("returns nothing for a user who is not a member of the app", async () => {
    const user = await createUser(h.ctx, { email: "stranger@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })

    expect(await productPermissionsFor(h.ctx.db, user.id, "acme", CATALOG)).toEqual([])
  })

  it("returns nothing when the request has no app context", async () => {
    const user = await createUser(h.ctx, { email: "noapp@acme.test" })
    await createMember(h.ctx, { app: "acme", userId: user.id, role: "admin" })

    expect(await productPermissionsFor(h.ctx.db, user.id, undefined, CATALOG)).toEqual([])
  })

  it("does not leak membership from another app", async () => {
    const user = await createUser(h.ctx, { email: "multi@acme.test" })
    await createApplication(h.ctx, { app: "acme", permissions: CATALOG })
    await createApplication(h.ctx, { app: "other", permissions: CATALOG })
    await createMember(h.ctx, { app: "other", userId: user.id, role: "admin" })

    expect(await productPermissionsFor(h.ctx.db, user.id, "acme", CATALOG)).toEqual([])
  })
})
