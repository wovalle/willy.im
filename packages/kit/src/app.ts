import { handle, type HandlerContext } from "./api.js"
import type { OnCall } from "./method.js"
import type { PermissionsResult } from "./permissions.js"
import { buildService, registry, type Factory } from "./registry.js"
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
  /** Called once per call from every surface, with the outcome. For logs, metrics and tracing. */
  onCall?: (event: CallEvent<KitFields & B & { services: any }>) => void | Promise<void>
  discovery?: DiscoveryOptions
}

/**
 * The app: `context` resolves the caller, builds the context and every service
 * on it, eagerly, into a plain object. Factories only touch `ctx.services`
 * inside method bodies, so the build order doesn't matter.
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
      for (const [name, factory] of Object.entries(config.services))
        ctx.services[name] = buildService(factory, ctx, name, config.onCall as OnCall | undefined)
      return ctx
    },
    handle: (request, ctx) => handle(app, request, ctx),
  }
  validateDiscovery(config.discovery)
  registry(app) // fail fast: a factory that uses ctx while building, or a bad tool name
  return app
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
   * a null principal is anonymous), the app's base context, and every service
   * bound to it. Throws a 404 `Response` for a tenant the principal has nothing in.
   */
  context: (principal: Principal | null, tenantId: string | null, ...args: A) => Promise<Context>
  /** Serves `/api/<service>.<method>`, `/openapi.json` and `/llms.txt`; null for any other path. */
  handle: (request: Request, ctx: HandlerContext) => Promise<Response | null>
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
