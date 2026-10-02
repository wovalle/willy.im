import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { workspaceClaimsFor } from "../app/lib/claims.server"
import type { Caller } from "../app/lib/caller.server"
import {
  listWorkspaceMembers,
  removeWorkspaceMember,
  setWorkspaceMember,
} from "../app/lib/workspace-members.server"
import { createApplication, createUser, createWorkspace, fakeUserCaller } from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/**
 * Workspace membership: the rows the workspaces claim carries. Until this
 * existed nothing could write them, so apps that take their tenants from the
 * IdP saw nobody in any workspace.
 */
describe("workspace members", () => {
  let h: TestHarness
  let manager: Caller
  let reader: Caller
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
    manager = fakeUserCaller({ userId: admin.id, app: "calque", permissions: ["member:manage", "member:read"] })
    reader = fakeUserCaller({ userId: admin.id, app: "calque", permissions: ["member:read"] })
  })
  afterEach(() => h.close())

  const set = (role: "owner" | "admin" | "member", as = manager, workspaceId = ws.id) =>
    setWorkspaceMember(h.ctx, as, { app: "calque", workspaceId, email: "Designer@romo.test", role })

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
    const res = await listWorkspaceMembers(h.ctx, reader, { app: "calque", workspaceId: ws.id })
    expect(res).toEqual({ members: [expect.objectContaining({ userId: person.id, role: "admin" })] })
  })

  it("removes a member", async () => {
    await set("member")
    expect(await removeWorkspaceMember(h.ctx, manager, { app: "calque", workspaceId: ws.id, userId: person.id })).toEqual({
      ok: true,
    })
    expect(await workspaceClaimsFor(h.ctx.db, person.id, "calque")).toEqual([])
    expect(
      await removeWorkspaceMember(h.ctx, manager, { app: "calque", workspaceId: ws.id, userId: person.id }),
    ).toMatchObject({ error: "not_a_member" })
  })

  it("needs member:manage to write and member:read to list", async () => {
    await expect(set("member", reader)).rejects.toMatchObject({ status: 403 })
    const nobody = fakeUserCaller({ userId: person.id, app: "calque", permissions: [] })
    await expect(listWorkspaceMembers(h.ctx, nobody, { app: "calque", workspaceId: ws.id })).rejects.toMatchObject({
      status: 403,
    })
  })

  it("another app's workspace is unknown, and so is an email with no user", async () => {
    expect(await set("member", manager, other.id)).toMatchObject({ error: "unknown_workspace" })
    expect(
      await setWorkspaceMember(h.ctx, manager, { app: "calque", workspaceId: ws.id, email: "nobody@x.test", role: "member" }),
    ).toMatchObject({ error: "unknown_user" })
  })
})
