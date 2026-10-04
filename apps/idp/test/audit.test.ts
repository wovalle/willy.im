import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { IdpPrincipal } from "../app/lib/caller.server"
import {
  bootstrapAdminKey,
  createApplication,
  failureOf,
  kitContext,
  memberPrincipal,
} from "./helpers/fixtures"
import { createTestHarness, type TestHarness } from "./helpers/harness"

/** audit.list: an app reads its own trail, newest first, and nothing else's. */
describe("audit.list", () => {
  let h: TestHarness
  let root: IdpPrincipal

  beforeEach(async () => {
    h = createTestHarness()
    root = (await bootstrapAdminKey(h.ctx)).principal
    await createApplication(h.ctx, { app: "acme" })
    await createApplication(h.ctx, { app: "other" })
  })
  afterEach(() => h.close())

  const services = async (app: string, principal = root) =>
    (await kitContext(h.ctx, principal, app)).services

  it("lists this app's entries newest first, up to the limit, and none of another app's", async () => {
    const acme = await services("acme")
    await acme.workspaces.create({ name: "One", slug: "one" })
    await acme.workspaces.create({ name: "Two", slug: "two" })
    await (await services("other")).workspaces.create({ name: "Three", slug: "three" })

    const { entries } = await acme.audit.list({})
    expect(entries.map((e) => [e.tableName, e.operation, e.actor])).toEqual([
      ["organization", "create", root.id],
      ["organization", "create", root.id],
    ])
    expect(entries[0].id).toBeGreaterThan(entries[1].id)
    expect((await acme.audit.list({ limit: 1 })).entries).toHaveLength(1)
    expect((await failureOf(acme.audit.list({ limit: 500 }))).status).toBe(400)
  })

  it("needs audit:read", async () => {
    const reader = await services("acme", memberPrincipal("u1", "acme", ["app:read"]))
    expect((await failureOf(reader.audit.list({}))).status).toBe(403)
  })
})
