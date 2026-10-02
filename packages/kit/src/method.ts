import { z } from "zod"
import {
  META,
  type CallEvent,
  type Contract,
  type FnArgs,
  type Method,
  type MethodMeta,
  type PublicMethod,
  type SchemaLike,
} from "./types.js"

type Unbound = { [META]: MethodMeta; fn: (input?: unknown) => unknown }

export type OnCall = (event: CallEvent<any>) => void | Promise<void>

const INVALID: unique symbol = Symbol.for("kit.invalid-input")
const PUBLIC: unique symbol = Symbol.for("kit.public-error")
/** The internal entry of a bound method: the result, and the output parsed to the contract. */
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

/** A contract's `input` / `output` as a schema: a plain shape is wrapped in `z.object`. */
export const toSchema = (s: SchemaLike): z.ZodType => ("_zod" in s ? (s as z.ZodType) : z.object(s))

/** Does the method exist in this context? A `when` that throws counts as false, and is logged. */
export const available = (contract: Contract, ctx: unknown) => {
  if (!contract.when) return true
  try {
    return contract.when(ctx as never)
  } catch (e) {
    console.error("kit: a `when` threw; the method is hidden", e)
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

export type Invocation = { result: unknown; parsed: unknown }
type Invoke = (raw?: unknown) => Promise<Invocation>

/** Calls a bound method for an edge: the output comes back already parsed (stripped). */
export const invoke = (bound: unknown, raw?: unknown): Promise<Invocation> =>
  (bound as { [INVOKE]: Invoke })[INVOKE](raw)

// Awaited, so an audit write finishes before the response (Workers drop late work);
// a failing onCall is logged and never fails the call.
const report = async (onCall: OnCall | undefined, event: CallEvent<any>) => {
  if (!onCall) return
  try {
    await onCall(event)
  } catch (e) {
    console.error(`kit: onCall threw for ${event.service}.${event.method}`, e)
  }
}

/**
 * Binds a method to one context. A call runs, in order: `when`, the permission,
 * the input, the implementation, the output check, then `onCall` with the outcome.
 * Internal callers get the implementation's full value; the edges strip it.
 */
export function bind(
  m: Unbound,
  ctx: any,
  service: string,
  name: string,
  onCall?: OnCall,
): PublicMethod {
  const { contract } = m[META]
  const input = contract.input && toSchema(contract.input)
  const output = contract.output && toSchema(contract.output)
  const run: Invoke = async (raw?: unknown) => {
    if (!available(contract, ctx)) throw unknownMethod(`${service}.${name}`)
    const started = performance.now()
    let value = raw
    const done = (ok: boolean, error?: unknown) =>
      report(onCall, {
        service,
        method: name,
        ctx,
        input: value,
        ok,
        ...(!ok && { error }),
        ms: performance.now() - started,
      })
    try {
      requireAccess(ctx.caller, contract.permission)
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
      let parsed: unknown
      if (output) {
        const checked = output.safeParse(result)
        if (!checked.success)
          throw new Error(
            `kit: ${service}.${name} returned a value its output schema rejects: ${checked.error.message}`,
          )
        parsed = checked.data
      }
      await done(true)
      return { result, parsed }
    } catch (error) {
      await done(false, error)
      throw error
    }
  }
  // Internal callers get the full value; the edges call [INVOKE] for the parsed one.
  const call = async (raw?: unknown) => (await run(raw)).result
  return Object.assign(call, {
    [META]: { contract, service, method: name },
    [INVOKE]: run,
  }) as never
}

/** The field errors of a 400 thrown by `bind`, or undefined for anything else. */
export const invalidFields = (e: unknown) =>
  e instanceof Response && INVALID in e
    ? (e[INVALID] as Partial<Record<string, string[]>>)
    : undefined
