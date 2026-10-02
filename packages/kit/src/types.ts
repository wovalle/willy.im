import type { z } from "zod"
import type * as permissions from "./permissions.js"

/**
 * The app registers its three pieces here, once:
 *
 *   declare module "@willyim/kit" {
 *     interface Register { auth: typeof auth; context: typeof context; services: typeof services }
 *   }
 *
 * Separate keys on purpose: registering `typeof app` makes a type cycle.
 */
export interface Register {}

// Lazy indexed access. `Register extends { context: infer C }` collapses the
// service types to `any`; this form doesn't.
type Reg<K extends string> = K extends keyof Register ? Register[K] : never

// The registered catalog: permission names and resource types. Unregistered: plain strings.
type Catalog = [Reg<"auth">] extends [never]
  ? { p: string; res: string }
  : Reg<"auth"> extends {
        permissions: readonly (infer P extends string)[]
        resources: readonly (infer Res extends string)[]
      }
    ? { p: P; res: Res }
    : { p: string; res: string }

/** A grant in this app: `"*"`, a permission, a `"ns:*"` wildcard or a resource instance. */
export type Grant = permissions.Grant<Catalog["p"], Catalog["res"]>

/** Who is calling, with grants typed from the app's catalog. */
export type Principal = permissions.Principal<Grant>

/** `ctx.caller`: the principal's grants in the request's tenant. */
export type Caller = permissions.Caller<Catalog["p"], Catalog["res"]>

/** What kit hands the app's `context` builder, before the app's own arguments. */
export type ContextInput = {
  principal: Principal | null
  tenantId: string | null
  caller: Caller
  /** Who is really acting: `principal.actor.id` when impersonating, else `principal.id`. */
  actor: string | null
}

/** What kit adds to the app's base context, besides `services`. */
export type KitFields = Omit<ContextInput, "principal">

/** The app's context builder's return, plus `caller`, `tenantId` and `actor`. */
export type BaseContext = KitFields &
  (Reg<"context"> extends (...args: any[]) => infer B ? Awaited<B> : never)

/** The built services: each factory's return, keyed by the name the app gave it. */
export type Services = {
  [K in keyof Reg<"services">]: Reg<"services">[K] extends (ctx: any) => infer S ? S : never
}

/** The context every method sees: the app's base context plus `services`. */
export type Context = BaseContext & { services: Services }

/** Permission names (and resource instances), from the registered catalog. */
export type Permission = Catalog["p"] | `${Catalog["res"]}:${string}`

/** Resource types whose instances can be granted (`definePermissions({ resources })`). */
export type Resource = Catalog["res"]

/**
 * Who may call a method: a permission, `"*"` for superadmins only, or
 * `{ resource }` for anyone holding at least one instance of that resource
 * (`"thread:abc"`) or a wildcard over it. With `{ resource }` the body checks the
 * specific id with `ctx.caller.has`.
 */
export type Access = [Resource] extends [never]
  ? Permission | "*"
  : Permission | "*" | { resource: Resource }

/** A zod schema, or a plain shape (`{ id: z.string() }`) that kit wraps in `z.object`. */
export type SchemaLike = z.ZodType | z.core.$ZodShape
export type SchemaOf<T> = T extends z.ZodType
  ? T
  : T extends z.core.$ZodShape
    ? z.ZodObject<T>
    : never

/** Behaviour an agent may rely on. Adapters map them to MCP tool annotations. */
export type Hints = {
  /** Changes nothing. */
  readOnly?: boolean
  /** May delete or overwrite data. */
  destructive?: boolean
  /** Calling it twice with the same input does nothing more than calling it once. */
  idempotent?: boolean
}

export type Contract<
  I extends SchemaLike | undefined = SchemaLike | undefined,
  O extends SchemaLike | undefined = SchemaLike | undefined,
> = {
  /** One line for an agent choosing a method: a verb, and what comes back. */
  summary: string
  /** The long text: rules, examples, edge cases. Tool descriptions use it instead of `summary`. */
  description?: string
  /** Who may call it: a permission, `"*"` or `{ resource }` (see `Access`). */
  permission: Access
  /** Omitted: the method takes no arguments. */
  input?: I
  /** Omitted: the method returns nothing. */
  output?: O
  /**
   * Where the method exists. Omitted: everywhere. When it returns false the
   * method is missing from every listing, and calling it is the same error as
   * calling a name that doesn't exist. It receives the request's context.
   */
  when?: (ctx: BaseContext) => boolean
  hints?: Hints
  /** The public tool name. Defaults to `<service>_<method>`. */
  name?: string
}

export const META: unique symbol = Symbol.for("kit.method")

/** What a public method carries for the adapters and discovery. */
export type MethodMeta<I = unknown, O = unknown> = {
  contract: Contract & { input?: I; output?: O }
  /** Set when the service is built. */
  service: string
  method: string
}

/** Argument list a caller passes: nothing without an input, `z.input` of it otherwise. */
export type CallArgs<I> = [I] extends [undefined] ? [] : [input: z.input<SchemaOf<I>>]
/** Argument list the implementation receives: the parsed input. */
export type FnArgs<I> = [I] extends [undefined] ? [] : [input: z.output<SchemaOf<I>>]

/** A public method as callers see it: the contract's input in, the implementation's result out. */
export type PublicMethod<I = any, O = any, R = any> = {
  (...args: CallArgs<I>): Promise<R>
  readonly [META]: MethodMeta<I, O>
}

/**
 * What `method` returns. `F` stays a type argument of an object literal type,
 * whose members TypeScript resolves only when used, so typing a service never
 * evaluates a body's return type. `PublicMethod<I, O, ReturnType<F>>` would, and
 * services calling each other become circular.
 */
export type Method<I, O, F extends (...args: any[]) => any> = {
  (...args: CallArgs<I>): Promise<Awaited<ReturnType<F>>>
  readonly [META]: MethodMeta<I, O>
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Partial<Record<string, string[]>> }

/** What `onCall` receives, once per call to a method that exists in the context. */
export type CallEvent<C = Context> = {
  service: string
  method: string
  ctx: C
  /** The parsed input, or the raw one when it failed to parse. */
  input: unknown
  /**
   * Made by another operation through the `ctx.services` its service closes
   * over (the permission wasn't checked); false for a call that entered the app.
   */
  internal: boolean
  ok: boolean
  /** What the call threw: a 403/400/404 `Response`, an `Error`, … */
  error?: unknown
  ms: number
}

type Methods<S> = S extends (ctx: any) => infer M ? M : never
type Registered = Reg<"services">

/** `"service.method"` for every public method in the app. */
export type PublicName = {
  [G in keyof Registered & string]: {
    [K in keyof Methods<Registered[G]> & string]: Methods<Registered[G]>[K] extends {
      [META]: unknown
    }
      ? `${G}.${K}`
      : never
  }[keyof Methods<Registered[G]> & string]
}[keyof Registered & string]

// One message per public method whose return doesn't fit its contract.
type Mismatch<Name extends string, M> = M extends { [META]: MethodMeta<any, infer O> } & ((
  ...args: any[]
) => Promise<infer R>)
  ? [O] extends [undefined]
    ? [R] extends [void | undefined]
      ? never
      : `${Name} returns a value but its contract has no output schema`
    : [R] extends [z.input<SchemaOf<O>>]
      ? never
      : `${Name} returns a value its output schema rejects`
  : never

/**
 * Checked once, at `createApp`, after every service type is resolved. Checking
 * inside `method` or `declareService` would make TypeScript evaluate a body's
 * return type while the service is still being typed, and inference collapses.
 */
export type ContractErrors<S> = {
  [G in keyof S & string]: {
    [K in keyof Methods<S[G]> & string]: Mismatch<`${G}.${K}`, Methods<S[G]>[K]>
  }[keyof Methods<S[G]> & string]
}[keyof S & string]
