// A small notes app registered against kit, shared by every test and by the
// type tests. `Register` is global, so this is the one registration.
import { z } from "zod"
import {
  createApp,
  declareService,
  definePermissions,
  definePolicies,
  fail,
  kitImage,
  method,
  type CallEvent,
} from "../src/index.js"

export const auth = definePermissions({
  permissions: ["notes:read", "notes:write", "tags:read"],
  resources: ["thread"],
  roles: { owner: ["notes:read", "notes:write", "tags:read"], viewer: ["notes:read"] },
})

export type Caller = {
  kind: "user" | "key" | "system" | "anonymous"
  userId: string
  workspaceId: string
} & ReturnType<typeof auth.checkerFor>

export const policies = definePolicies({
  note: (caller: Caller) => ({ workspaceId: caller.workspaceId }),
})

type Row = { id: string; title: string; workspaceId: string; secret: string }
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

    broken: method(
      { summary: "Return something the contract rejects.", permission: "notes:read", output: Note },
      async () => ({ id: "1", title: 7 }) as never,
    ),
  }),
  { description: "Notes." },
)

export const tags = declareService((ctx) => ({
  forNote: method(
    {
      summary: "Get the tags of a note.",
      permission: "tags:read",
      input: { id: z.string() },
      output: { tags: z.array(z.string()), title: z.string() },
    },
    // service-to-service: notes.get checks notes:read against the same caller
    async ({ id }) => ({ tags: ["a"], title: (await ctx.services.notes.get({ id })).title }),
  ),
}))

export const context = ({ caller, thread = null }: { caller: Caller; thread?: string | null }) => ({
  caller,
  thread,
  scope: policies(caller),
})

export const services = { notes, tags }

export const events: CallEvent<any>[] = []

export const app = createApp({
  name: "notes",
  description: "Fixture app.",
  context,
  system: ({ workspaceId }: { workspaceId: string }) =>
    context({
      caller: { kind: "system", userId: "system", workspaceId, ...auth.checkerFor(["*"]) },
    }),
  services,
  onCall: (e) => {
    events.push(e)
  },
})

export const user = (grants: string[]): Caller => ({
  kind: "user",
  userId: "u1",
  workspaceId: "w1",
  ...auth.checkerFor(grants),
})

export const anonymous = (): Caller => ({ ...user([]), kind: "anonymous" })

/** The status of a call that may throw a `Response`. */
export const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e) => (e instanceof Response ? e.status : Promise.reject(e)),
  )

declare module "../src/index.js" {
  interface Register {
    context: typeof context
    services: typeof services
  }
}
