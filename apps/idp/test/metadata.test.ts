import { describe, expect, it } from "vitest"

import { parseAppMetadata, serializeAppMetadata } from "../app/lib/metadata"

/** The stored shape of an app's catalog, across the versions of it that exist in D1. */
describe("app metadata", () => {
  it("round-trips resource types through the one serializer", () => {
    const meta = parseAppMetadata(
      serializeAppMetadata({
        app: "bender",
        allow_signup: false,
        permissions: ["kirby:read"],
        resources: ["https://bender.test/mcp"],
        resource_types: [{ type: "kirby:thread", label: "Thread", list: "https://bender.test/t" }],
      }),
    )
    expect(meta.resource_types).toEqual([
      { type: "kirby:thread", label: "Thread", list: "https://bender.test/t" },
    ])
    expect(meta.permissions).toEqual(["kirby:read"])
  })

  it("reads a row written before resource types existed as declaring none", () => {
    const meta = parseAppMetadata(JSON.stringify({ app: "bender", permissions: ["kirby:read"] }))
    expect(meta).toMatchObject({ app: "bender", permissions: ["kirby:read"], resource_types: [] })
  })

  it("defaults a missing label to the type and dedupes by type", () => {
    const meta = parseAppMetadata({
      app: "bender",
      resource_types: [
        { type: "kirby:thread", list: "https://bender.test/t" },
        { type: "kirby:thread", label: "dup", list: "https://bender.test/u" },
      ],
    })
    expect(meta.resource_types).toEqual([
      { type: "kirby:thread", label: "kirby:thread", list: "https://bender.test/t" },
    ])
  })

  it("falls back to an empty config when a type entry is malformed (existing lenient behaviour)", () => {
    const meta = parseAppMetadata({
      app: "bender",
      permissions: ["kirby:read"],
      resource_types: [{ type: "kirby:*", list: "https://bender.test/t" }],
    })
    expect(meta.permissions).toEqual([])
    expect(meta.resource_types).toEqual([])
  })
})
