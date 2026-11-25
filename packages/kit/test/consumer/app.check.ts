// Compile-time only. `Register` must reach the published declarations.
import {
  collection,
  createApp,
  declareService,
  definePermissions,
  method,
  type Context,
  type ContextInput,
  type Principal,
} from "@willyim/kit"
import { z } from "zod"

const auth = definePermissions({ permissions: ["todos:read"], roles: { owner: ["todos:read"] } })

const context = (_kit: ContextInput, thread: string | null) => ({ thread })

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
  purge: method({ summary: "Purge.", permission: "*" }, async () => {}),
  page: collection({
    summary: "List todos, paged.",
    permission: "todos:read",
    row: z.object({ id: z.string(), text: z.string(), owner: z.string() }),
    fields: { default: ["id", "text"], hidden: ["owner"] },
    sorts: { id: { dir: "asc", key: (r) => r.id } },
    defaultSort: "id",
    limit: { default: 10, max: 50 },
    load: () => ({ rows: [{ id: "1", text: "a", owner: "u" }] }),
  }),
}))

const services = { todos }
const app = createApp({ auth, context, services })

declare module "@willyim/kit" {
  interface Register {
    auth: typeof auth
    context: typeof context
    services: typeof services
  }
}

export async function registered() {
  const principal: Principal = {
    id: "user:u1",
    grants: [],
    memberships: [{ tenantId: "w1", grants: auth.roles.owner }],
  }
  const ctx: Context = await app.context(principal, "w1", null)
  ctx.caller.has("todos:read")
  ctx.caller.require("todos:*")
  ctx.thread satisfies string | null
  ctx.actor satisfies string | null
  ;(await ctx.services.todos.list()) satisfies string[]
  const page = await ctx.services.todos.page({ select: ["text"] })
  page.rows[0]!.text satisfies string
  // @ts-expect-error not selected
  page.rows[0]!.id
  // @ts-expect-error hidden
  await ctx.services.todos.page({ select: ["owner"] })
  // @ts-expect-error not a permission of this app
  ctx.caller.has("todos:write")
  // @ts-expect-error not a grant of this app
  const typo: Principal = { id: "u", grants: ["todo:read"], memberships: [] }
  declareService(() => ({
    // @ts-expect-error this app declares no resources, so `{ resource }` isn't an access rule
    x: method({ summary: "x", permission: { resource: "thread" } }, async () => {}),
  }))
  return [typo, await app.handle(new Request("https://x.test/openapi.json"), ctx)]
}
