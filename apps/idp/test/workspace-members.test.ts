import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { workspaceClaimsFor } from "../app/lib/claims.server"
import type { IdpPrincipal } from "../app/lib/caller.server"
import { listAuditForApp } from "../app/lib/audit.server"
import {
  bootstrapAdminKey,
  createApplication,
  createUser,
  createWorkspace,
  failureOf,
  kitContext,
  memberPrincipal,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Workspace membership: the rows the workspaces claim carries. Until this
 * existed nothing could write them, so apps that take their tenants from the
 * IdP saw nobody in any workspace.
 */
describe("workspace_members", () => {
  let h: TestHarness
  let manager: IdpPrincipal
  let reader: IdpPrincipal
  let ws: { id: string }
  let other: { id: string }
  let person: { id: string }

  beforeEach(async () => {
    h = createTestHarness()
    await createApplication(h.ctx, { app: "calque", permissions: ["projects:read"] })
    await createApplication(h.ctx, { app: "kasso", permissions: [] })
    ws = await createWorkspace(h.ctx, { app: "calque", slug: "romo" })
    other = await createWorkspace(h.ctx, { app: "kasso", slug: "kasso-ws" })
    person = await createUser(h.ctx, { email: "designer@romo.test" })
    const admin = await createUser(h.ctx, { email: "admin@romo.test" })
    manager = memberPrincipal(admin.id, "calque", ["member:manage", "workspace:read"])
    reader = memberPrincipal(admin.id, "calque", ["workspace:read"])
  })
  afterEach(() => h.close())

  const as = async (principal: IdpPrincipal) =>
    (await kitContext(h.ctx, principal, "calque")).services.workspace_members
  const set = async (role: "owner" | "admin" | "member", by = manager, workspaceId = ws.id) =>
    (await as(by)).set({ workspaceId, email: "Designer@romo.test", role })

  it("puts a user in a workspace; the workspaces claim carries it with the role", async () => {
    expect(await set("owner")).toMatchObject({ userId: person.id, role: "owner" })
    expect(await workspaceClaimsFor(h.ctx.db, person.id, "calque")).toEqual([
      expect.objectContaining({ id: ws.id, slug: "romo", role: "owner" }),
    ])
    expect(await workspaceClaimsFor(h.ctx.db, person.id, "kasso")).toEqual([])
  })

  it("is idempotent and changes the role in place", async () => {
    await set("member")
    await set("member")
    await set("admin")
    expect(await (await as(reader)).list({ workspaceId: ws.id })).toEqual({
      members: [expect.objectContaining({ userId: person.id, role: "admin" })],
    })
    const entries = await listAuditForApp(h.ctx, "calque")
    expect(entries.map((e) => [e.tableName, e.operation])).toEqual([
      ["member", "update"],
      ["member", "create"],
    ])
  })

  it("removes a member, and 404s one who isn't there", async () => {
    await set("member")
    const members = await as(manager)
    expect(await members.remove({ workspaceId: ws.id, userId: person.id })).toEqual({ ok: true })
    expect(await workspaceClaimsFor(h.ctx.db, person.id, "calque")).toEqual([])
    expect(await failureOf(members.remove({ workspaceId: ws.id, userId: person.id }))).toEqual({
      status: 404,
      error: "They aren't in this workspace.",
    })
  })

  it("needs member:manage to write and workspace:read to list", async () => {
    expect((await failureOf(set("member", reader))).status).toBe(403)
    const nobody = await as(memberPrincipal(person.id, "calque", []))
    expect((await failureOf(nobody.list({ workspaceId: ws.id }))).status).toBe(403)
  })

  it("another app's workspace is unknown, and so is an email with no user", async () => {
    expect(await failureOf(set("member", manager, other.id))).toEqual({
      status: 404,
      error: "No such workspace in calque.",
    })
    const missing = (await as(manager)).set({
      workspaceId: ws.id,
      email: "nobody@x.test",
      role: "member",
    })
    expect((await failureOf(missing)).status).toBe(404)
  })
})

describe("workspaces", () => {
  let h: TestHarness
  let root: IdpPrincipal
  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "calque" })
    await createApplication(h.ctx, { app: "kasso" })
  })
  afterEach(() => h.close())

  const workspaces = async (app: string | null, principal = root) =>
    (await kitContext(h.ctx, principal, app)).services.workspaces

  it("creates a workspace in the app, lists it there and nowhere else, and audits it", async () => {
    const created = await (await workspaces("calque")).create({ name: " Romo ", slug: "romo" })
    expect(created).toMatchObject({ name: "Romo", slug: "romo" })

    expect((await (await workspaces("calque")).list()).workspaces).toEqual([
      expect.objectContaining({ id: created.id, slug: "romo", applicationId: "calque" }),
    ])
    expect((await (await workspaces("kasso")).list()).workspaces).toEqual([])
    expect((await listAuditForApp(h.ctx, "calque"))[0]).toMatchObject({
      tableName: "organization",
      operation: "create",
      rowId: created.id,
    })
  })

  it("409s a slug another app already took", async () => {
    await createWorkspace(h.ctx, { app: "kasso", slug: "romo" })
    expect(await failureOf((await workspaces("calque")).create({ name: "R", slug: "romo" }))).toEqual({
      status: 409,
      error: 'Slug "romo" is already taken.',
    })
  })

  it("needs workspace:create to create one", async () => {
    const reader = memberPrincipal("u1", "calque", ["workspace:read"])
    expect(
      (await failureOf((await workspaces("calque", reader)).create({ name: "R", slug: "r" }))).status,
    ).toBe(403)
  })

  it("lists people across the app's workspaces", async () => {
    const romo = await createWorkspace(h.ctx, { app: "calque", slug: "romo" })
    await createUser(h.ctx, { email: "designer@romo.test" })
    const members = (await kitContext(h.ctx, root, "calque")).services.workspace_members
    await members.set({ workspaceId: romo.id, email: "designer@romo.test", role: "owner" })
    expect((await (await workspaces("calque")).people()).people).toEqual([
      { email: "designer@romo.test", name: "designer@romo.test", workspace: "romo", role: "owner" },
    ])
  })

  it("lists every app's workspaces at the IdP level, to superadmins only", async () => {
    await createWorkspace(h.ctx, { app: "calque", slug: "a" })
    await createWorkspace(h.ctx, { app: "kasso", slug: "b" })
    expect((await (await workspaces(null)).list_all()).workspaces).toHaveLength(2)

    const staff = { id: "user:u1", grants: [], memberships: [] }
    expect((await failureOf((await workspaces(null, staff)).list_all())).status).toBe(403)
  })
})
