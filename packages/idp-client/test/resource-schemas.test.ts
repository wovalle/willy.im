import { describe, expect, it } from "vitest"

import {
  ResourceInstanceSchema,
  ResourceListSchema,
  SetAppPermissionsInput,
} from "../src/schemas/index.js"

/** The resource-scope halves of the wire contract, as an app would parse them. */
describe("resource-scope schemas", () => {
  it("defaults resourceTypes to [] so a flat-only catalog PUT is unchanged", () => {
    expect(SetAppPermissionsInput.parse({ permissions: ["a:read"] })).toEqual({
      permissions: ["a:read"],
      resourceTypes: [],
    })
  })

  it("rejects a type that is a wildcard or not lowercase segments", () => {
    for (const type of ["kirby:*", "Kirby:Thread", "kirby:", ":thread", "kirby thread"]) {
      expect(
        SetAppPermissionsInput.safeParse({ permissions: [], resourceTypes: [{ type, list: "https://x.test/l" }] })
          .success,
      ).toBe(false)
    }
  })

  it("rejects an instance id that is not one clean segment", () => {
    expect(ResourceInstanceSchema.safeParse({ id: "a:b", label: "x" }).success).toBe(false)
    expect(ResourceInstanceSchema.safeParse({ id: "t_1", label: "x" }).success).toBe(true)
  })

  it("parses a list with description absent", () => {
    expect(ResourceListSchema.parse({ resources: [{ id: "t_1", label: "Familia" }] })).toEqual({
      resources: [{ id: "t_1", label: "Familia" }],
    })
  })
})
