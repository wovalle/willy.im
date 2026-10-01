// Compile-time only. `Register` must reach the published declarations.
import { createApp, declareService, definePermissions, method, type Context } from "@willyim/kit"
import { z } from "zod"

const auth = definePermissions({ permissions: ["todos:read"], roles: { owner: ["todos:read"] } })

const context = (thread: string | null) => ({ caller: auth.createChecker("owner"), thread })

const todos = declareService(() => ({
  list: method(
    {
      summary: "List todos.",
      permission: "todos:read",
      output: z.array(z.string()),
      when: (ctx) => ctx.thread !== null,
    },
    async () => ["a"],
  ),
}))

const services = { todos }
const app = createApp({ context, services })

declare module "@willyim/kit" {
  interface Register {
    context: typeof context
    services: typeof services
  }
}

export async function registered() {
  const ctx: Context = await app.context(null)
  ctx.caller.has("todos:read")
  ctx.thread satisfies string | null
  ;(await ctx.services.todos.list()) satisfies string[]
  // @ts-expect-error not a permission of this app
  ctx.caller.has("todos:write")
  declareService(() => ({
    // @ts-expect-error this app declares no resources, so `{ resource }` isn't an access rule
    x: method({ summary: "x", permission: { resource: "thread" } }, async () => {}),
  }))
  return app.handle(new Request("https://x.test/openapi.json"), ctx)
}
