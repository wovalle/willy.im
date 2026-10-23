import { describe, expect, test } from "vitest"
import { z } from "zod"
import {
  createApp,
  declareService,
  handle,
  lazyService,
  loadServices,
  method,
  registry,
  tools,
} from "../src/index.js"
import { auth, context, member } from "./fixture.js"

/** A heavy service as an app would split it out: its own module, counted when it loads. */
function heavyModule() {
  const counts = { loads: 0, builds: 0 }
  const heavy = declareService(
    (ctx) => {
      counts.builds++
      return {
        echo: method(
          { summary: "echo", permission: "notes:read", input: { s: z.string() }, output: z.string() },
          async ({ s }) => `${s}:${ctx.tenantId}`,
        ),
        plain: async (n: number) => n * 2,
      }
    },
    { description: "A heavy service." },
  )
  const load = async () => {
    counts.loads++
    return heavy
  }
  return { counts, load }
}

function lazyApp() {
  const { counts, load } = heavyModule()
  const app = createApp({ auth, context, services: { heavy: lazyService(load) } })
  // The test app isn't the one registered for types, as in kit.test.ts.
  const ctx = async () => (await app.context(member("w1", ["notes:read"]), "w1")) as any
  return { app, counts, ctx }
}

describe("lazy services", () => {
  test("a lazy service's module doesn't load until one of its members is called", async () => {
    const { counts, ctx } = lazyApp()
    const c = await ctx()
    void c.services.heavy
    expect(counts).toEqual({ loads: 0, builds: 0 })
    expect(await c.services.heavy.echo({ s: "hi" })).toBe("hi:w1")
    expect(counts).toEqual({ loads: 1, builds: 1 })
  })

  test("once loaded, every context gets the real service, and the module loads once", async () => {
    const { counts, ctx } = lazyApp()
    await (await ctx()).services.heavy.echo({ s: "a" })
    const second = await ctx()
    expect(second.services.heavy.echo).toBeTypeOf("function")
    expect(await second.services.heavy.plain(2)).toBe(4)
    expect(counts.loads).toBe(1)
  })

  test("calls through a lazy service keep the method's permission", async () => {
    const { app } = lazyApp()
    const c = (await app.context(member("w1", []), "w1")) as any
    await expect(c.services.heavy.echo({ s: "x" })).rejects.toBeInstanceOf(Response)
  })

  test("a lazy service is not a thenable, so awaiting it doesn't load it", async () => {
    const { counts, ctx } = lazyApp()
    const c = await ctx()
    await c.services.heavy
    expect(counts.loads).toBe(0)
  })

  test("the registry asks for loadServices first, then lists the lazy service's methods", async () => {
    const { app } = lazyApp()
    expect(() => registry(app)).toThrow('service "heavy" is lazy and hasn\'t loaded')
    await loadServices(app)
    expect(registry(app).map((e) => [e.name, e.description])).toEqual([
      ["heavy.echo", "A heavy service."],
    ])
    expect(tools(app, await app.context(member("w1", ["notes:read"]), "w1")).map((t) => t.name)).toEqual([
      "heavy_echo",
    ])
  })

  test("handle loads lazy services itself", async () => {
    const { app, ctx } = lazyApp()
    const res = await handle(
      app,
      new Request("https://x.test/api/heavy.echo", { method: "POST", body: JSON.stringify({ s: "api" }) }),
      await ctx(),
    )
    expect(await res?.json()).toBe("api:w1")
  })

  test("a failed load can be retried", async () => {
    let attempts = 0
    const { load } = heavyModule()
    const app = createApp({
      auth,
      context,
      services: {
        heavy: lazyService(async () => {
          if (attempts++ === 0) throw new Error("chunk failed")
          return load()
        }),
      },
    })
    const c = (await app.context(member("w1", ["notes:read"]), "w1")) as any
    await expect(c.services.heavy.echo({ s: "x" })).rejects.toThrow("chunk failed")
    expect(await c.services.heavy.echo({ s: "y" })).toBe("y:w1")
  })
})
