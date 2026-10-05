import { handle, type HandleOptions, type HandlerContext } from "./api.js"
import { defaultLogApp } from "./log.js"
import { logCall, type OnCall } from "./method.js"
import type { PermissionsResult } from "./permissions.js"
import { bindService, linkViews, registry, type Factory } from "./registry.js"
import type {
  CallEvent,
  Context,
  ContextInput,
  ContractErrors,
  KitFields,
  Principal,
} from "./types.js"

/** A service: a factory from the context to plain methods and `method(...)`s. */
export function declareService<S>(
  factory: (ctx: Context) => S,
  options: { description?: string } = {},
) {
  return Object.assign(factory, { description: options.description })
}

// A property whose type is the message, so the compile error names the method:
// `Property '"kit: contract mismatch"' is missing … '"clients.get returns a value its output schema rejects"'`.
type ContractCheck<S> = [ContractErrors<S>] extends [never]
  ? unknown
  : { "kit: contract mismatch": ContractErrors<S> }

// The same trick for a context builder that returns a field kit sets itself.
type OwnFieldsCheck<B> = [keyof B & keyof KitFields] extends [never]
  ? unknown
  : { "kit: the context builder returns fields kit sets": keyof B & keyof KitFields }

export type DiscoveryOptions = {
  /**
   * What a caller with no credentials (`caller.kind === "anonymous"`) sees in
   * `/openapi.json` and `/llms.txt`: every method, as documentation (`"all"`,
   * the default), or none.
   */
  anonymous?: "all" | "none"
  /**
   * With `anonymous: "none"`: how to authenticate, told to a caller with no
   * credentials by `/llms.txt`, `/openapi.json` and the 401 from `/api/*`.
   */
  auth?: {
    /** Free text: "Send `Authorization: Bearer <key>`; get a key at …". */
    instructions: string
    /** Where a person mints a key. */
    keysUrl?: string
    /** RFC 9728 protected-resource metadata, for OAuth (MCP) clients. */
    oauth?: { resourceMetadataUrl: string }
  }
  /** The wording of `/openapi.json` and `/llms.txt` for credentials and errors. Neutral by default. */
  docs?: {
    /** The token placeholder in "Authorization: Bearer <key>". */
    key?: string
    /** The bearer security scheme's description. */
    bearer?: string
    errors?: { unauthorized?: string; forbidden?: string; notFound?: string; conflict?: string }
  }
}

type AppConfig<A extends unknown[], B, S> = {
  /** The app's name: the title of its OpenAPI document and llms.txt, and the MCP server name. */
  name?: string
  /** One paragraph for discovery: what the app is for. */
  description?: string
  /** The app's `definePermissions` result: it turns a principal into `ctx.caller`. */
  auth: PermissionsResult<any, any, any>
  /**
   * Builds the app's part of a request's context (`db`, `scope`, `logger`…) from
   * what kit resolved, plus the app's own arguments. kit adds `caller`,
   * `tenantId` and `actor`; don't return them.
   */
  context: (kit: ContextInput, ...args: A) => B | Promise<B>
  services: S
  /**
   * Called once per call from every surface, with the outcome. For logs, metrics
   * and tracing. Without one, kit logs a `call` line per call (README → Logging).
   */
  onCall?: (event: CallEvent<KitFields & B & { services: any }>) => void | Promise<void>
  discovery?: DiscoveryOptions
}

/**
 * The app: `context` resolves the caller and builds the context. Each service
 * on `ctx.services` is built the first time it's read, once per context.
 * Factories only touch `ctx.services` inside method bodies, so services may
 * call each other in any order.
 *
 * Factories get a copy of the context whose `services` bind the same methods
 * as trusted: a call one operation makes to another skips the permission, which
 * the call that entered the app has passed. `app.context` returns the checked one.
 */
export function createApp<A extends unknown[], B, S extends Record<string, Factory>>(
  config: AppConfig<A, B, S> & ContractCheck<S> & OwnFieldsCheck<B>,
) {
  const app: App<A, AppConfig<A, B, S> & ContractCheck<S> & OwnFieldsCheck<B>> = {
    config,
    context: async (principal, tenantId, ...args) => {
      // Before the app's builder runs: a tenant the principal can't see is a 404.
      const caller = config.auth.callerFor(principal, tenantId)
      const actor = principal?.actor?.id ?? principal?.id ?? null
      const base = await config.context({ principal, tenantId, caller, actor }, ...args)
      const ctx: any = { ...base, caller, tenantId, actor, services: {} }
      // What factories close over: the same values, with trusted services.
      const inner: any = { ...ctx, services: {} }
      linkViews(inner.services, ctx.services)
      const shared: Shared = {
        factories: config.services,
        inner,
        ctx,
        onCall: (config.onCall as OnCall | undefined) ?? logCall,
        built: new Map(),
        building: new Set(),
      }
      servicesView(ctx.services, shared, false)
      servicesView(inner.services, shared, true)
      return ctx
    },
    handle: (request, ctx, options) => handle(app, request, ctx, options),
  }
  defaultLogApp(config.name)
  validateDiscovery(config.discovery)
  registry(app) // fail fast: a factory that uses ctx while building, or a bad tool name
  return app
}

/** What both views of a context's services share: one built instance per factory. */
type Shared = {
  factories: Record<string, Factory>
  inner: object
  ctx: unknown
  onCall: OnCall | undefined
  built: Map<string, object>
  building: Set<string>
}

/** A service's factory, run on first read and kept; both views of a context share it. */
function built(shared: Shared, name: string) {
  const hit = shared.built.get(name)
  if (hit) return hit
  if (shared.building.has(name))
    throw new Error(
      `kit: service "${name}" was read while it builds; use ctx.services only inside method bodies`,
    )
  shared.building.add(name)
  try {
    const service = shared.factories[name](shared.inner)
    shared.built.set(name, service)
    return service
  } finally {
    shared.building.delete(name)
  }
}

const views = new WeakMap<object, { shared: Shared; internal: boolean }>()

const setService = (services: object, name: string, value: unknown) =>
  Object.defineProperty(services, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })

// One accessor pair per service name, shared by every context.
const accessors = new Map<string, PropertyDescriptor>()
function lazyService(name: string): PropertyDescriptor {
  let accessor = accessors.get(name)
  if (!accessor) {
    accessor = {
      enumerable: true,
      configurable: true,
      get(this: object) {
        const services = viewOf(this)
        const { shared, internal } = views.get(services)!
        const service = bindService(built(shared, name), shared.ctx, name, shared.onCall, internal)
        setService(services, name, service)
        return service
      },
      set(this: object, value: unknown) {
        setService(viewOf(this), name, value)
      },
    }
    accessors.set(name, accessor)
  }
  return accessor
}

function viewOf(target: object) {
  for (let o: object | null = target; o; o = Object.getPrototypeOf(o)) if (views.has(o)) return o
  throw new Error("kit: a service was read outside ctx.services")
}

/** `services[name]` for every service, built on first read and kept; enumerable, so `Object.keys` lists it. */
function servicesView(services: object, shared: Shared, internal: boolean) {
  views.set(services, { shared, internal })
  for (const name of Object.keys(shared.factories))
    Object.defineProperty(services, name, lazyService(name))
}

function validateDiscovery(discovery: DiscoveryOptions | undefined) {
  const url = discovery?.auth?.oauth?.resourceMetadataUrl
  if (url === undefined) return
  let ok = false
  try {
    ok = ["https:", "http:"].includes(new URL(url).protocol)
  } catch {}
  if (!ok)
    throw new Error(`kit: discovery.auth.oauth.resourceMetadataUrl is not a valid URL: ${url}`)
}

// Spelled out so the emitted declarations keep `Context` as an alias, which the
// app's `Register` then resolves, instead of inlining kit's unregistered one.
export type App<A extends unknown[], C> = {
  config: C
  /**
   * The only door: the caller of `principal` in `tenantId` (null: no tenant;
   * a null principal is anonymous), the app's base context, and its services,
   * each built on first read. Throws a 404 `Response` for a tenant the principal has nothing in.
   */
  context: (principal: Principal | null, tenantId: string | null, ...args: A) => Promise<Context>
  /**
   * Serves `/api/<service>.<method>`, `/openapi.json` and `/llms.txt`, under
   * `options.basePath` when given; null for any other path.
   */
  handle: (
    request: Request,
    ctx: HandlerContext,
    options?: HandleOptions,
  ) => Promise<Response | null>
}

/** What the adapters need from an app. */
export type KitApp = {
  config: {
    name?: string
    description?: string
    services: Record<string, Factory>
    discovery?: DiscoveryOptions
  }
}
