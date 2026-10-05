import { z } from "zod"
import { getLogger } from "./log.js"
import {
  META,
  type CallEvent,
  type Contract,
  type FnArgs,
  type Method,
  type MethodMeta,
  type PublicMethod,
  type SchemaLike,
  type Surface,
} from "./types.js"

const log = getLogger("kit")

type Unbound = { [META]: MethodMeta; fn: (input?: unknown) => unknown }

export type OnCall = (event: CallEvent<any>) => void | Promise<void>

const INVALID: unique symbol = Symbol.for("kit.invalid-input")
const PUBLIC: unique symbol = Symbol.for("kit.public-error")
/** The edge entry of a bound method: the output parsed (stripped) to the contract. */
export const INVOKE: unique symbol = Symbol.for("kit.invoke")

/**
 * Marks an error `Response` as meant for callers: `tools()` and MCP pass its
 * message on. Kit marks its own (`fail`, 400, 403, 404) and the caller's denials.
 */
export const publicError = <R extends Response>(res: R): R => Object.assign(res, { [PUBLIC]: true })
export const isPublicError = (e: unknown): e is Response => e instanceof Response && PUBLIC in e

/**
 * A public method: a contract plus its implementation.
 *
 * `F`'s constraint returns `any` on purpose: TypeScript then never evaluates the
 * body's return type while a service is typed, which is what lets services call
 * each other through `ctx.services`. Whether the return fits `output` is checked
 * once, at `createApp`.
 */
export function method<
  I extends SchemaLike | undefined = undefined,
  O extends SchemaLike | undefined = undefined,
  F extends (...args: FnArgs<I>) => any = (...args: FnArgs<I>) => any,
>(contract: Contract<I, O>, fn: F): Method<I, O, F> {
  const unbound = () => {
    throw new Error("kit: call public methods through ctx.services")
  }
  const meta: MethodMeta = { contract, service: "", method: "" }
  return Object.assign(unbound, { [META]: meta, fn }) as never
}

export const isMethod = (value: unknown): value is Unbound =>
  typeof value === "function" && META in value

const wrapped = new WeakMap<object, z.ZodType>()

/**
 * A contract's `input` / `output` as a schema: a plain shape is wrapped in
 * `z.object`, once per shape, so every binding, the registry and the adapters
 * share one schema.
 */
export const toSchema = (s: SchemaLike): z.ZodType => {
  if ("_zod" in s) return s as z.ZodType
  let schema = wrapped.get(s)
  if (!schema) wrapped.set(s, (schema = z.object(s)))
  return schema
}

/** Does the method exist in this context? A `when` that throws counts as false, and is logged. */
export const available = (contract: Contract, ctx: unknown) => {
  if (!contract.when) return true
  try {
    return contract.when(ctx as never)
  } catch (e) {
    log.error("when.threw", { error: e })
    return false
  }
}

type Caller = {
  has(permission: string): boolean
  require(...grants: string[]): void
  hasAny?(resource: string): boolean
}

/** An access rule at run time: a permission, `"*"` (superadmins only), or `{ resource }`. */
type Access = string | { resource: string }

const forbidden = () => publicError(new Response("Forbidden", { status: 403 }))

/** May this caller call a method with this access rule? `"*"` passes only a superadmin's `has`. */
export const permitted = (caller: Caller, access: Access) =>
  typeof access === "string" ? caller.has(access) : (caller.hasAny?.(access.resource) ?? false)

/** Throws the caller's own denial (a 403, or whatever its `require` throws). */
export const requireAccess = (caller: Caller, access: Access) => {
  if (typeof access !== "string") {
    if (!permitted(caller, access)) throw forbidden()
    return
  }
  try {
    caller.require(access)
  } catch (e) {
    throw e instanceof Response ? publicError(e) : e
  }
}

/** How an access rule reads in discovery. */
export const describeAccess = (access: Access) =>
  access === "*" ? "superadmin" : typeof access === "string" ? access : `${access.resource}:<id>`

/** The error for a method that doesn't exist, or doesn't exist in this context. */
export const unknownMethod = (name: string) =>
  publicError(Response.json({ error: `no method ${name}; see /openapi.json` }, { status: 404 }))

type Edge = Exclude<Surface, "direct" | "internal">
type Invoke = (raw: unknown, surface: Edge) => Promise<unknown>

/** Calls a bound method for an edge: the output comes back checked and stripped to the contract. */
export const invoke = (bound: unknown, raw: unknown, surface: Edge): Promise<unknown> => {
  const edge = (bound as { [INVOKE]?: Invoke })[INVOKE]
  if (!edge)
    throw new Error("kit: an edge called a trusted method; pass it what app.context returns")
  return edge(raw, surface)
}

// Awaited, so an audit write finishes before the response (Workers drop late work);
// a failing onCall is logged and never fails the call.
const report = async (onCall: OnCall | undefined, event: CallEvent<any>) => {
  if (!onCall) return
  try {
    await onCall(event)
  } catch (e) {
    log.error("onCall.threw", { call: `${event.service}.${event.method}`, error: e })
  }
}

/**
 * The `onCall` an app gets when it passes none: one `call` line per call that
 * entered the app (`debug` for internal ones), `warn` for a 4xx, `error` for a failure.
 */
export const logCall: OnCall = ({ service, method, ctx, surface, ok, error, ms }) => {
  const status = error instanceof Response ? error.status : undefined
  const level = ok
    ? surface === "internal"
      ? "debug"
      : "info"
    : status !== undefined && status < 500
      ? "warn"
      : "error"
  log[level]("call", {
    call: `${service}.${method}`,
    surface,
    actor: (ctx as { actor?: unknown } | undefined)?.actor ?? null,
    ok,
    ms: Math.round(ms),
    ...(!ok && { error }),
  })
}

/** One method bound to one context: what a call needs, shared by both of its entries. */
type Binding = {
  m: Unbound
  ctx: any
  service: string
  name: string
  onCall: OnCall | undefined
  internal: boolean
}

const checkOutput = ({ service, name }: Binding, schema: z.ZodType, result: unknown) => {
  const checked = schema.safeParse(result)
  if (!checked.success)
    throw new Error(
      `kit: ${service}.${name} returned a value its output schema rejects: ${checked.error.message}`,
    )
  return checked.data
}

// Edge calls (`/api`, `tools()`, MCP) return the output checked and stripped; internal ones, the raw value.
async function run(b: Binding, raw: unknown, edge?: Edge) {
  const { m, ctx, service, name, onCall, internal } = b
  const { contract } = m[META]
  if (!available(contract, ctx)) throw unknownMethod(`${service}.${name}`)
  const started = performance.now()
  let value = raw
  const done = (ok: boolean, error?: unknown) =>
    report(onCall, {
      service,
      method: name,
      ctx,
      input: value,
      internal,
      surface: edge ?? (internal ? "internal" : "direct"),
      ok,
      ...(!ok && { error }),
      ms: performance.now() - started,
    })
  try {
    if (!internal) requireAccess(ctx.caller, contract.permission)
    const input = contract.input && toSchema(contract.input)
    if (input) {
      const parsed = input.safeParse(raw)
      if (!parsed.success) {
        const { formErrors, fieldErrors } = z.flattenError(parsed.error)
        // Errors on the input as a whole (a root `.refine`, a wrong type) go under "_".
        const fields = {
          ...(formErrors.length > 0 && { _: formErrors }),
          ...fieldErrors,
        } as Partial<Record<string, string[]>>
        throw Object.assign(
          publicError(Response.json({ error: "invalid input", fields }, { status: 400 })),
          { [INVALID]: fields },
        )
      }
      value = parsed.data
    }
    const result = await (input ? m.fn(value) : m.fn())
    const out = edge && contract.output ? checkOutput(b, toSchema(contract.output), result) : result
    await done(true)
    return out
  } catch (error) {
    await done(false, error)
    throw error
  }
}

/**
 * Binds a method to one context. A call runs, in order: `when`, the permission,
 * the input, the implementation, then `onCall` with the outcome. Only the edges
 * check the output, between the implementation and `onCall`, and strip it to the
 * contract; in-process callers get the implementation's value as is.
 *
 * `internal` binds the method for other operations (the `ctx` factories close
 * over): the permission is skipped, the operation that entered the app having
 * been checked already, and there is no edge entry. `ctx` is always the checked
 * context `app.context` returned, so `when` and `onCall` never see the trusted view.
 */
export function bind(
  m: Unbound,
  ctx: any,
  service: string,
  name: string,
  onCall: OnCall | undefined,
  internal: boolean,
): PublicMethod {
  const b: Binding = { m, ctx, service, name, onCall, internal }
  const bound = Object.assign((raw?: unknown) => run(b, raw), {
    [META]: { contract: m[META].contract, service, method: name },
  })
  if (!internal)
    Object.assign(bound, { [INVOKE]: (raw: unknown, surface: Edge) => run(b, raw, surface) })
  return bound as never
}

/** The field errors of a 400 thrown by `bind`, or undefined for anything else. */
export const invalidFields = (e: unknown) =>
  e instanceof Response && INVALID in e
    ? (e[INVALID] as Partial<Record<string, string[]>>)
    : undefined
