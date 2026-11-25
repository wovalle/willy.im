// Compile-time tests, checked by `npm run typecheck` (never executed). Every
// `@ts-expect-error` must fail to compile, or tsc reports it as unused.
import { z } from "zod"
import {
  collection,
  createApp,
  declareService,
  kitImage,
  method,
  type Context,
  type Grant,
  type Principal,
  type PublicName,
} from "../src/index.js"
import { app, auth, context, services } from "./fixture.js"

declare const ctx: Context

export async function realTypes() {
  // a service calling itself (notes.get → notes.find) resolves to real types
  const note = await ctx.services.notes.get({ id: "1" })
  note.title satisfies string
  note.secret satisfies string // internal callers get the full value
  // @ts-expect-error title is a string, not any
  const n: number = note.title

  // a service calling another (tags.forNote → notes.get) resolves to real types
  const tags = await ctx.services.tags.forNote({ id: "1" })
  // @ts-expect-error tags is a string[], not any
  const t: number = tags.tags

  // private methods keep their plain signatures
  // @ts-expect-error find takes a string id
  await ctx.services.notes.find(1)

  // the input is the schema's input type: z.coerce.number() accepts anything
  await ctx.services.notes.create({ title: "x", pages: "7" })
  return [n, t]
}

export async function inputs() {
  // @ts-expect-error unknown field
  await ctx.services.notes.get({ nope: "1" })
  // @ts-expect-error wrong type
  await ctx.services.notes.get({ id: 1 })
  // @ts-expect-error input is required when the contract has one
  await ctx.services.notes.get()
  // @ts-expect-error list has no input, so it takes no arguments
  await ctx.services.notes.list({})
  const nothing = await ctx.services.notes.remove({ id: "1" })
  nothing satisfies void
}

export function publicNames() {
  const ok: PublicName[] = ["notes.get", "notes.reply", "tags.forNote"]
  // @ts-expect-error find is private
  const priv: PublicName = "notes.find"
  return [ok, priv]
}

export const contractFields = declareService(() => ({
  x: method(
    {
      summary: "x",
      // @ts-expect-error not in the caller's permission catalog
      permission: "clients:read",
      // `when` sees the app's context
      // @ts-expect-error the context has no `channel`
      when: (c) => c.channel !== null,
    },
    async () => {},
  ),
  instance: method({ summary: "y", permission: "thread:abc" }, async () => {}),
  superadminOnly: method({ summary: "z", permission: "*" }, async () => {}),
}))

const wrongReturn = declareService(() => ({
  get: method(
    { summary: "Get.", permission: "notes:read", output: { id: z.string() } },
    async () => ({ id: 1 }), // id should be a string
  ),
}))

const returnsWithoutOutput = declareService(() => ({
  remove: method({ summary: "Delete.", permission: "notes:write" }, async () => 42),
}))

const imageOutput = declareService(() => ({
  shot: method(
    { summary: "Shot.", permission: "notes:read", output: { image: kitImage } },
    async () => ({ image: { data: "", mediaType: "image/png" as const } }),
  ),
}))

export function contractChecks() {
  createApp({ auth, context, services: { ...services, imageOutput } })
  // @ts-expect-error "bad.get returns a value its output schema rejects"
  createApp({ auth, context, services: { ...services, bad: wrongReturn } })
  // @ts-expect-error "bad.remove returns a value but its contract has no output schema"
  createApp({ auth, context, services: { ...services, bad: returnsWithoutOutput } })
}

export async function principals() {
  const ok: Principal = {
    id: "user:u1",
    grants: ["*", "notes:*", "thread:abc", "thread:*"],
    memberships: [{ tenantId: "w1", grants: auth.roles.owner }],
  }
  // @ts-expect-error a typo in a grant literal
  const typo: Principal = { id: "user:u1", grants: ["notes:raed"], memberships: [] }
  // @ts-expect-error a wildcard over a namespace the catalog doesn't have
  const unknownNs: Grant = "billing:*"
  // grants from the DB go through parseGrants, which types them
  const parsed: Grant[] = auth.parseGrants(["notes:read"]).grants
  // @ts-expect-error raw strings aren't grants
  await app.context({ id: "user:u1", grants: [] as string[], memberships: [] }, null)
  return [ok, typo, unknownNs, parsed]
}

export async function contextArgs() {
  // the app's own arguments follow the principal and the tenant
  const c = await app.context(null, null, { thread: "t1" })
  c.tenantId satisfies string | null
  c.actor satisfies string | null
  c.caller.require("notes:*", "thread:abc")
  // @ts-expect-error require takes grants of this app
  c.caller.require("notes:raed")
  // @ts-expect-error the tenant is a string id
  await app.context(null, 1)
  // @ts-expect-error a context builder must not return `caller`: kit builds it
  createApp({ auth, context: () => ({ caller: 1 }), services })
  // @ts-expect-error `auth` is required
  createApp({ context, services })
}

export async function collections() {
  // no input: the first page, default fields
  const first = await ctx.services.notes.history()
  first.rows[0]!.id satisfies string
  first.rows[0]!.title satisfies string
  // @ts-expect-error not in the default fields
  first.rows[0]!.workspaceId
  first.next satisfies object | null
  first.query.sort satisfies "title" | "id"

  // select narrows the rows
  const picked = await ctx.services.notes.history({ select: ["title"] })
  picked.rows[0]!.title satisfies string
  // @ts-expect-error not selected
  picked.rows[0]!.id

  // a gated field comes back optional
  const gated = await ctx.services.notes.history({ select: ["id", "workspaceId"] })
  const ws: string | null | undefined = gated.rows[0]!.workspaceId
  // @ts-expect-error gated: may be absent
  const wsRequired: string | null = gated.rows[0]!.workspaceId

  // "*": every visible field, gated ones optional, hidden never
  const all = await ctx.services.notes.history({ select: "*" })
  all.rows[0]!.title satisfies string
  // @ts-expect-error hidden
  all.rows[0]!.secret

  // the next page round-trips as input
  if (first.next) await ctx.services.notes.history(first.next)

  // meta is typed by its schema, and optional: load decides which pages carry it
  first.meta?.matching satisfies number | undefined
  // @ts-expect-error meta may be absent
  first.meta.matching

  // @ts-expect-error hidden fields aren't selectable
  await ctx.services.notes.history({ select: ["secret"] })
  // @ts-expect-error not a field
  await ctx.services.notes.history({ select: ["txet"] })
  // @ts-expect-error not a declared sort
  await ctx.services.notes.history({ sort: "name" })
  // @ts-expect-error cursor paging takes no page
  await ctx.services.notes.history({ page: 2 })
  // @ts-expect-error where is typed
  await ctx.services.notes.history({ where: { q: 1 } })

  const names: PublicName[] = ["notes.history"]
  return [ws, wsRequired, names]
}

declareService(() => ({
  x: collection({
    summary: "x",
    permission: "notes:read",
    row: z.object({ id: z.string(), title: z.string(), secret: z.string() }),
    // @ts-expect-error not a field of row
    fields: { default: ["id", "txet"] },
    sorts: { id: { dir: "asc", key: (r) => r.id } },
    defaultSort: "id",
    limit: { default: 10, max: 10 },
    load: () => ({ rows: [] }),
  }),
  y: collection({
    summary: "y",
    permission: "notes:read",
    row: z.object({ id: z.string() }),
    fields: { default: ["id"] },
    sorts: { id: { dir: "asc", key: (r) => r.id } },
    // @ts-expect-error not a declared sort
    defaultSort: "name",
    limit: { default: 10, max: 10 },
    load: () => ({ rows: [] }),
  }),
}))

// A collection's load is checked at createApp, like a method's return.
const noTotal = declareService(() => ({
  z: collection({
    summary: "z",
    permission: "notes:read",
    row: z.object({ id: z.string() }),
    fields: { default: ["id"] },
    sorts: { id: { dir: "asc", key: (r) => r.id } },
    defaultSort: "id",
    paging: "page",
    limit: { default: 10, max: 10 },
    load: () => ({ rows: [{ id: "1" }] }),
  }),
}))

const wrongRows = declareService(() => ({
  w: collection({
    summary: "w",
    permission: "notes:read",
    row: z.object({ id: z.string() }),
    fields: { default: ["id"] },
    sorts: { id: { dir: "asc", key: (r) => r.id } },
    defaultSort: "id",
    limit: { default: 10, max: 10 },
    load: async () => ({ rows: [{ id: 1 }] }),
  }),
}))

export function loadChecks() {
  // @ts-expect-error "bad.z loads rows or meta its schemas reject": page paging needs total
  createApp({ auth, context, services: { ...services, bad: noTotal } })
  // @ts-expect-error "bad.w loads rows or meta its schemas reject"
  createApp({ auth, context, services: { ...services, bad: wrongRows } })
  // @ts-expect-error "bad.m loads rows or meta its schemas reject": meta doesn't fit
  createApp({ auth, context, services: { ...services, bad: wrongMeta } })
  // @ts-expect-error "bad.u loads rows or meta its schemas reject": no meta declared
  createApp({ auth, context, services: { ...services, bad: undeclaredMeta } })
  // meta on some pages only is fine
  createApp({ auth, context, services: { ...services, ok: someMeta } })
}

const metaCollection = <T>(load: (args: { after: unknown }) => T) =>
  declareService(() => ({
    m: collection({
      summary: "m",
      permission: "notes:read",
      row: z.object({ id: z.string() }),
      fields: { default: ["id"] },
      sorts: { id: { dir: "asc", key: (r) => r.id } },
      defaultSort: "id",
      limit: { default: 10, max: 10 },
      meta: { title: z.string() },
      load,
    }),
  }))

const wrongMeta = metaCollection(() => ({ rows: [{ id: "1" }], meta: { title: 1 } }))
const someMeta = metaCollection(({ after }) =>
  after ? { rows: [{ id: "2" }] } : { rows: [{ id: "1" }], meta: { title: "t" } },
)
const undeclaredMeta = declareService(() => ({
  u: collection({
    summary: "u",
    permission: "notes:read",
    row: z.object({ id: z.string() }),
    fields: { default: ["id"] },
    sorts: { id: { dir: "asc", key: (r) => r.id } },
    defaultSort: "id",
    limit: { default: 10, max: 10 },
    load: () => ({ rows: [{ id: "1" }], meta: { title: "t" } }),
  }),
}))

// `after.key` is typed per sort: narrowing on `sort` gives that sort's key, and `after.id` the
// id field's type.
export const sortKeys = collection({
  summary: "k",
  permission: "notes:read",
  row: z.object({ n: z.int(), last: z.string(), first: z.string(), score: z.number() }),
  id: "n",
  fields: { default: ["n"] },
  sorts: {
    score: { dir: "desc", key: (r) => r.score },
    name: { dir: "asc", key: (r) => [r.last, r.first] },
  },
  defaultSort: "score",
  limit: { default: 10, max: 10 },
  load: (args) => {
    if (args.after) {
      args.after.id satisfies number
      // @ts-expect-error the id field is a number
      args.after.id satisfies string
      if (args.sort === "score") {
        args.after.key satisfies number
        // @ts-expect-error a number, not a tuple
        args.after.key[0]
      } else {
        args.after.key satisfies readonly [string, string]
        // @ts-expect-error a tuple, not a number
        args.after.key satisfies number
        // @ts-expect-error two components
        args.after.key[2]
      }
    }
    return { rows: [] }
  },
})

// The same narrowing works on destructured arguments.
export const sortKeysDestructured = collection({
  summary: "k",
  permission: "notes:read",
  row: z.object({ id: z.string(), last: z.string(), first: z.string() }),
  fields: { default: ["id"] },
  sorts: {
    name: { dir: "asc", key: (r) => [r.last, r.first] },
    id: { dir: "asc", key: (r) => r.id },
  },
  defaultSort: "name",
  limit: { default: 10, max: 10 },
  load: ({ sort, after }) => {
    if (after && sort === "name") {
      // the default id field, "id", is a string here
      after.id satisfies string
      // @ts-expect-error not a number
      after.id satisfies number
      const [last, first] = after.key
      last satisfies string
      first satisfies string
    }
    // @ts-expect-error not narrowed: a string or a tuple
    if (after) after.key satisfies string
    return { rows: [] }
  },
})

// Page paging, typed on the collection itself (this file never runs).
const paged = collection({
  summary: "p",
  permission: "notes:read",
  row: z.object({ id: z.string() }),
  fields: { default: ["id"] },
  sorts: { id: { dir: "asc", key: (r) => r.id } },
  defaultSort: "id",
  paging: "page",
  limit: { default: 10, max: 10 },
  load: ({ offset }) => ({ rows: [{ id: String(offset) }], total: 1 }),
})

export async function pageMeta() {
  // without a meta schema the page has no meta
  // @ts-expect-error no meta declared
  ;(await paged({ page: 1 })).meta
}

export async function pagePaging() {
  const page = await paged({ page: 2 })
  page.total satisfies number
  page.query.page satisfies number
  // @ts-expect-error page paging takes no cursor
  await paged({ cursor: "x" })
}
