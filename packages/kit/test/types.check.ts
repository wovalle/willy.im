// Compile-time tests, checked by `npm run typecheck` (never executed). Every
// `@ts-expect-error` must fail to compile, or tsc reports it as unused.
import { z } from "zod"
import {
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
