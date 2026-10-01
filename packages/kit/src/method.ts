import { z } from "zod"
import {
  META,
  type Access,
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
  require(permission: string): void
  hasAny?(resource: string): boolean
}

const forbidden = () => new Response("Forbidden", { status: 403 })

/** May this caller call a method with this access rule? */
export const permitted = (caller: Caller, access: Access) =>
  typeof access === "string"
    ? caller.has(access)
    : (caller.hasAny?.(access.resource as string) ?? false)

/** Throws the caller's own denial (a 403, or whatever its `require` throws). */
export const requireAccess = (caller: Caller, access: Access) => {
  if (typeof access === "string") caller.require(access)
  else if (!permitted(caller, access)) throw forbidden()
}

/** How an access rule reads in discovery. */
export const describeAccess = (access: Access) =>
  typeof access === "string" ? access : `${access.resource as string}:<id>`

// What `bind` parsed from an object result, so the edges don't parse it again.
const parsedOutputs = new WeakMap<object, unknown>()

/** The output stripped to the contract: the value `bind` already parsed, or a fresh parse. */
export const stripOutput = (result: unknown, output: SchemaLike) =>
  result !== null && typeof result === "object" && parsedOutputs.has(result)
    ? parsedOutputs.get(result)
    : toSchema(output).parse(result)

/** The error for a method that doesn't exist, or doesn't exist in this context. */
export const unknownMethod = (name: string) =>
  Response.json({ error: `no method ${name}; see /openapi.json` }, { status: 404 })

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
  const call = async (raw?: unknown) => {
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
          throw Object.assign(Response.json({ error: "invalid input", fields }, { status: 400 }), {
            [INVALID]: fields,
          })
        }
        value = parsed.data
      }
      const result = await (input ? m.fn(value) : m.fn())
      if (output) {
        const checked = output.safeParse(result)
        if (!checked.success)
          throw new Error(
            `kit: ${service}.${name} returned a value its output schema rejects: ${checked.error.message}`,
          )
        if (result !== null && typeof result === "object") parsedOutputs.set(result, checked.data)
      }
      await done(true)
      return result
    } catch (error) {
      await done(false, error)
      throw error
    }
  }
  return Object.assign(call, { [META]: { contract, service, method: name } }) as never
}

/** The field errors of a 400 thrown by `bind`, or undefined for anything else. */
export const invalidFields = (e: unknown) =>
  e instanceof Response && INVALID in e
    ? (e[INVALID] as Partial<Record<string, string[]>>)
    : undefined
