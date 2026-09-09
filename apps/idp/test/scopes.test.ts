import { describe, expect, it } from "vitest"

import { ResourceListError, type ResourceLister } from "../app/lib/resources.server"
import {
  adminScopesFor,
  classifyScope,
  isDeclared,
  resolveScopes,
  type AppCatalog,
} from "../app/lib/scopes.server"
import { stubResources } from "./helpers/fixtures"

/**
 * The grammar of a grant. A flat entry matches exactly; `<type>:<id>` is an
 * instance under a declared type. Everything here is pure — no database, and
 * the lister is only reached once structure has passed.
 */
const THREAD = {
  type: "kirby:thread",
  label: "WhatsApp conversation",
  list: "https://bender.test/idp/resources/kirby-thread",
}
const CATALOG: AppCatalog = { permissions: ["kirby:read", "kirby:write"], resourceTypes: [THREAD] }

describe("classifyScope", () => {
  it("matches a flat permission exactly, and only exactly", () => {
    expect(classifyScope("kirby:read", CATALOG)).toEqual({ kind: "permission", scope: "kirby:read" })
    expect(classifyScope("kirby:rea", CATALOG)).toBeNull()
    expect(classifyScope("kirby:read:x", CATALOG)).toBeNull()
  })

  it("recognises an instance under a declared type", () => {
    expect(classifyScope("kirby:thread:t_14f451b6", CATALOG)).toEqual({
      kind: "instance",
      scope: "kirby:thread:t_14f451b6",
      type: THREAD,
      id: "t_14f451b6",
    })
  })

  it("lets a flat entry win over a type that would also claim it", () => {
    const both: AppCatalog = { permissions: ["kirby:thread:all"], resourceTypes: [THREAD] }
    expect(classifyScope("kirby:thread:all", both)).toEqual({ kind: "permission", scope: "kirby:thread:all" })
  })

  it("picks the longest declared type when one prefixes another", () => {
    const nested: AppCatalog = {
      permissions: [],
      resourceTypes: [
        { type: "invoices", label: "invoice", list: "https://x.test/a" },
        { type: "invoices:workspace", label: "workspace", list: "https://x.test/b" },
      ],
    }
    expect(classifyScope("invoices:workspace:acme", nested)).toMatchObject({ kind: "instance", id: "acme" })
    expect(classifyScope("invoices:inv_1", nested)).toMatchObject({ kind: "instance", id: "inv_1", type: { type: "invoices" } })
  })

  it("refuses an id that is not one clean segment", () => {
    for (const bad of ["kirby:thread:", "kirby:thread:a:b", "kirby:thread:*", "kirby:thread:a b"]) {
      expect(classifyScope(bad, CATALOG)).toBeNull()
    }
  })

  it("knows nothing about an undeclared type", () => {
    expect(classifyScope("artifacts:abc", CATALOG)).toBeNull()
    expect(isDeclared("artifacts:abc", CATALOG)).toBe(false)
    expect(isDeclared("kirby:thread:t_1", CATALOG)).toBe(true)
  })
})

describe("adminScopesFor", () => {
  it("is the flat catalog plus a wildcard per resource type", () => {
    expect(adminScopesFor(CATALOG)).toEqual(["kirby:read", "kirby:write", "kirby:thread:*"])
  })
})

describe("resolveScopes", () => {
  const listed = stubResources({ "kirby:thread": [{ id: "t_1", label: "Familia", description: null }] })

  it("never calls the lister for flat scopes", async () => {
    const lister: ResourceLister = async () => {
      throw new Error("must not be called")
    }
    expect(await resolveScopes([" kirby:read ", "kirby:read"], "bender", CATALOG, lister)).toEqual({
      ok: true,
      scopes: ["kirby:read"],
    })
  })

  it("rejects undeclared scopes before any network call", async () => {
    let calls = 0
    const lister: ResourceLister = async () => {
      calls++
      return []
    }
    expect(await resolveScopes(["kirby:thread:t_1", "artifacts:abc"], "bender", CATALOG, lister)).toEqual({
      error: "unknown_scopes",
      detail: ["artifacts:abc"],
    })
    expect(calls).toBe(0)
  })

  it("accepts an instance the app lists and stores the composed string", async () => {
    expect(await resolveScopes(["kirby:thread:t_1", "kirby:read"], "bender", CATALOG, listed)).toEqual({
      ok: true,
      scopes: ["kirby:thread:t_1", "kirby:read"],
    })
  })

  it("names the composed grant when the instance is not listed", async () => {
    expect(await resolveScopes(["kirby:thread:t_nope"], "bender", CATALOG, listed)).toEqual({
      error: "unknown_resource",
      detail: ["kirby:thread:t_nope"],
    })
  })

  it("asks the lister once per type, not once per id", async () => {
    let calls = 0
    const lister: ResourceLister = async () => {
      calls++
      return [
        { id: "a", label: "A", description: null },
        { id: "b", label: "B", description: null },
      ]
    }
    const res = await resolveScopes(["kirby:thread:a", "kirby:thread:b"], "bender", CATALOG, lister)
    expect(res).toMatchObject({ ok: true })
    expect(calls).toBe(1)
  })

  it("reports the types whose list could not be read", async () => {
    const down: ResourceLister = async ({ type }) => {
      throw new ResourceListError(type.type, "unreachable", "down")
    }
    expect(await resolveScopes(["kirby:thread:t_1"], "bender", CATALOG, down)).toEqual({
      error: "resource_lookup_failed",
      detail: ["kirby:thread"],
    })
  })
})
