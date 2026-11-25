// A small notes app registered against kit, shared by every test and by the
// type tests. `Register` is global, so this is the one registration.
import { z } from "zod"
import {
  collection,
  createApp,
  declareService,
  definePermissions,
  definePolicies,
  fail,
  kitImage,
  method,
  type CallEvent,
  type ContextInput,
  type Grant,
  type Principal,
} from "../src/index.js"

export const auth = definePermissions({
  permissions: ["notes:read", "notes:write", "tags:read"],
  resources: ["thread"],
  roles: { owner: ["notes:read", "notes:write", "tags:read"], viewer: ["notes:read"] },
})

export const policies = definePolicies({
  note: (caller: { tenantId: string | null }) => ({ workspaceId: caller.tenantId }),
})

type Row = { id: string; title: string; workspaceId: string | null; secret: string }
export const rows = new Map<string, Row>()
export const reset = () => {
  rows.clear()
  rows.set("1", { id: "1", title: "First", workspaceId: "w1", secret: "s" })
}
reset()

export const Note = z.object({ id: z.string(), title: z.string() })

export const notes = declareService(
  (ctx) => ({
    find: async (id: string) => rows.get(id) ?? null, // private

    list: method(
      { summary: "List notes.", permission: "notes:read", output: z.array(Note) },
      async () => [...rows.values()],
    ),

    get: method(
      {
        summary: "Get a note by id.",
        permission: "notes:read",
        input: { id: z.string() },
        output: Note,
      },
      async ({ id }) => (await ctx.services.notes.find(id)) ?? fail(404, "note not found"),
    ),

    create: method(
      {
        summary: "Create a note.",
        permission: "notes:write",
        input: z.object({ title: z.string().min(1), pages: z.coerce.number().int().positive() }),
        output: Note,
      },
      async ({ title }) => {
        const id = String(rows.size + 1)
        rows.set(id, { ...ctx.scope.note({ id }), title, secret: "s" })
        return { id, title }
      },
    ),

    remove: method(
      {
        summary: "Delete a note.",
        permission: "notes:write",
        input: { id: z.string() },
        hints: { destructive: true, idempotent: true },
      },
      async ({ id }) => {
        rows.delete(id)
      },
    ),

    reply: method(
      {
        summary: "Reply in the current thread.",
        description: "Posts the text as a reply. Only exists inside a thread.",
        permission: "notes:write",
        input: { text: z.string() },
        output: { thread: z.string() },
        when: (ctx) => ctx.thread !== null,
        name: "thread_reply",
      },
      async () => ({ thread: ctx.thread ?? "" }),
    ),

    snapshot: method(
      {
        summary: "Render a note as an image.",
        permission: "notes:read",
        input: { id: z.string() },
        output: { id: z.string(), image: kitImage },
        hints: { readOnly: true },
      },
      async ({ id }) => ({ id, image: { data: "iVBORw0KGgo=", mediaType: "image/png" as const } }),
    ),

    history: collection({
      summary: "List notes, paged.",
      permission: "notes:read",
      row: z.object({
        id: z.string(),
        title: z.string(),
        workspaceId: z.string().nullable(),
        secret: z.string(),
      }),
      fields: {
        default: ["id", "title"],
        hidden: ["secret"],
        gate: { workspaceId: () => ctx.caller.has("notes:write") },
      },
      where: { q: z.string().trim().min(1).optional().describe("Substring of the title.") },
      sorts: {
        title: { dir: "asc", key: (r) => [r.title, r.id] },
        id: { dir: "desc", key: (r) => Number(r.id) },
      },
      defaultSort: "id",
      limit: { default: 2, max: 3 },
      meta: { matching: z.int().describe("How many notes match `where`.") },
      // Rows come from another public method of this service: no type cycle.
      load: async ({ where, sort, dir, after, limit }) => {
        const listed = await ctx.services.notes.list()
        const key = (r: Row) => (sort === "title" ? `${r.title}\u0000${r.id}` : Number(r.id))
        const cmp = (a: Row, b: Row) => {
          const [x, y] = [key(a), key(b)]
          const c = x < y ? -1 : x > y ? 1 : 0
          return dir === "asc" ? c : -c
        }
        // narrowing on sort types after.key: [title, id] for "title", a number for "id"
        const from =
          after && (sort === "title" ? `${after.key[0]}\u0000${after.key[1]}` : after.key)
        const matching = listed
          .filter((r) => r.workspaceId === ctx.tenantId)
          .filter((r) => !where.q || r.title.includes(where.q))
        const all = matching
          .sort(cmp)
          .filter((r) => from === null || (dir === "asc" ? key(r) > from : key(r) < from))
        // meta on the first page only: load decides when
        if (after) return { rows: all.slice(0, limit) }
        return { rows: all.slice(0, limit), meta: { matching: matching.length } }
      },
    }),

    broken: method(
      { summary: "Return something the contract rejects.", permission: "notes:read", output: Note },
      async () => ({ id: "1", title: 7 }) as never,
    ),
  }),
  { description: "Notes." },
)

export const tags = declareService((ctx) => ({
  // A collection built on another service's collection: no type cycle across services either.
  titles: collection({
    summary: "List note titles.",
    permission: "tags:read",
    row: z.object({ id: z.string(), title: z.string() }),
    fields: { default: ["title"] },
    sorts: { id: { dir: "desc", key: (r) => Number(r.id) } },
    defaultSort: "id",
    limit: { default: 10, max: 10 },
    load: async () => {
      const page = await ctx.services.notes.history({ select: ["id", "title"], limit: 3 })
      return { rows: page.rows }
    },
  }),

  forNote: method(
    {
      summary: "Get the tags of a note.",
      permission: "tags:read",
      input: { id: z.string() },
      output: { tags: z.array(z.string()), title: z.string() },
    },
    // service-to-service: notes.get is trusted, so tags:read alone is enough
    async ({ id }) => ({ tags: ["a"], title: (await ctx.services.notes.get({ id })).title }),
  ),
}))

export const context = (
  { caller }: ContextInput,
  { thread = null }: { thread?: string | null } = {},
) => ({ thread, scope: policies(caller) })

export const services = { notes, tags }

export const events: CallEvent<any>[] = []

export const app = createApp({
  name: "notes",
  description: "Fixture app.",
  auth,
  context,
  services,
  onCall: (e) => {
    events.push(e)
  },
})

/** A person with `grants` in `tenantId` only. */
export const member = (tenantId: string, grants: Grant[]): Principal => ({
  id: "user:u1",
  grants: [],
  memberships: [{ tenantId, grants }],
})

/** An API key scoped to one tenant: one membership with the key's scopes. */
export const key = (tenantId: string, scopes: Grant[]): Principal => ({
  id: "apikey:k1",
  grants: [],
  memberships: [{ tenantId, grants: scopes }],
})

export const superadmin = (): Principal => ({ id: "user:root", grants: ["*"], memberships: [] })

/** No credentials. */
export const anonymous = null

/** A context in tenant w1 for a member holding `grants`. */
export const ctxFor = (grants: Grant[], thread: string | null = null) =>
  app.context(member("w1", grants), "w1", { thread })

/** The status of a call that may throw a `Response`. */
export const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e) => (e instanceof Response ? e.status : Promise.reject(e)),
  )

declare module "../src/index.js" {
  interface Register {
    auth: typeof auth
    context: typeof context
    services: typeof services
  }
}
