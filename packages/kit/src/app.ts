import { handle, type HandlerContext } from "./api.js"
import type { OnCall } from "./method.js"
import type { PermissionChecker } from "./permissions.js"
import { buildService, type Factory } from "./registry.js"
import type { CallEvent, Context, ContractErrors } from "./types.js"

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
}

type AppConfig<A extends unknown[], SA extends unknown[], B, S> = {
  /** The app's name: the title of its OpenAPI document and llms.txt, and the MCP server name. */
  name?: string
  /** One paragraph for discovery: what the app is for. */
  description?: string
  /** Builds the base context for a request: `caller`, `scope`, `db`, `logger`… */
  context: (...args: A) => B | Promise<B>
  /** Builds the base context for cron and queues. Its `caller` should be a superadmin. */
  system?: (...args: SA) => B | Promise<B>
  services: S
  /** Called once per call from every surface, with the outcome. For audit logs and metrics. */
  onCall?: (event: CallEvent<B & { services: any }>) => void | Promise<void>
  discovery?: DiscoveryOptions
}

/**
 * The app: its entry points build a context and every service on it, eagerly,
 * into a plain object. Factories only touch `ctx.services` inside method bodies,
 * so the build order doesn't matter.
 */
export function createApp<
  A extends unknown[],
  B extends { caller: PermissionChecker<any> },
  S extends Record<string, Factory>,
  SA extends unknown[] = never,
>(config: AppConfig<A, SA, B, S> & ContractCheck<S>) {
  const build = async (base: B | Promise<B>): Promise<Context> => {
    const ctx: any = { ...(await base), services: {} }
    for (const [name, factory] of Object.entries(config.services))
      ctx.services[name] = buildService(factory, ctx, name, config.onCall as OnCall | undefined)
    return ctx
  }
  const app: App<A, SA, AppConfig<A, SA, B, S> & ContractCheck<S>> = {
    config,
    context: (...args) => build(config.context(...args)),
    systemContext: (...args) => {
      if (!config.system) throw new Error("kit: createApp has no `system` context builder")
      return build(config.system(...args))
    },
    handle: (request, ctx) => handle(app, request, ctx),
  }
  return app
}

// Spelled out so the emitted declarations keep `Context` as an alias, which the
// app's `Register` then resolves, instead of inlining kit's unregistered one.
export type App<A extends unknown[], SA extends unknown[], C> = {
  config: C
  /** Builds the context for a request: the app's base context, plus every service bound to it. */
  context: (...args: A) => Promise<Context>
  /** The same, from the `system` builder, for cron and queues. */
  systemContext: (...args: SA) => Promise<Context>
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
